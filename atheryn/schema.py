"""A tiny validator for the JSON shapes ATHERYN accepts.

Supports the subset ATHERYN needs to validate structured proposals coming from
LLM providers or mission specs: type, required, properties, enum, minimum,
maximum, minLength, maxLength, items, additionalProperties.

`validate(value, schema)` returns a list of problem strings ([] == valid).
Nothing here executes or interprets content — it only checks shape.
"""
from __future__ import annotations

_TYPES = {"object": dict, "array": list, "string": str,
          "number": (int, float), "integer": int, "boolean": bool}


def validate(value, schema: dict, path: str = "$") -> list[str]:
    problems: list[str] = []
    expected_type = schema.get("type")
    if expected_type:
        python_types = _TYPES.get(expected_type)
        if python_types is None:
            return [f"{path}: unknown schema type {expected_type!r}"]

        # bool subclasses int in Python. Treating True as 1 here would let a
        # malformed provider response slip through a surprisingly common gap.
        if expected_type == "number" and isinstance(value, bool):
            problems.append(f"{path}: expected number, got bool")
        elif (
            not isinstance(value, python_types)
            or (expected_type == "integer" and isinstance(value, bool))
        ):
            return [f"{path}: expected {expected_type}, got {type(value).__name__}"]

    if "enum" in schema and value not in schema["enum"]:
        problems.append(f"{path}: {value!r} not in allowed {schema['enum']}")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            problems.append(f"{path}: shorter than {schema['minLength']} chars")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            problems.append(f"{path}: longer than {schema['maxLength']} chars")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            problems.append(f"{path}: {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            problems.append(f"{path}: {value} > maximum {schema['maximum']}")

    if isinstance(value, dict) and (schema.get("properties") or schema.get("required")):
        for field_name in schema.get("required", []):
            if field_name not in value:
                problems.append(f"{path}: missing required field {field_name!r}")

        properties = schema.get("properties", {})
        for key, item in value.items():
            if key in properties:
                problems.extend(validate(item, properties[key], f"{path}.{key}"))
            elif schema.get("additionalProperties") is False:
                problems.append(f"{path}: unexpected field {key!r}")

    if isinstance(value, list) and "items" in schema:
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            problems.append(f"{path}: more than {schema['maxItems']} items")
        for index, item in enumerate(value):
            problems.extend(validate(item, schema["items"], f"{path}[{index}]"))

    return problems
