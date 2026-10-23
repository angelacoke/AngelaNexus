package main

// The c-shared runtime uses bridge exports, never the upstream CLI entry point.
// Keep this package free of argument parsing, signal handlers and CLI startup.
func main() {}
