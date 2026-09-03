"""Let ``python -m atheryn`` behave like the command-line entry point."""
import sys
from .cli import main

sys.exit(main())
