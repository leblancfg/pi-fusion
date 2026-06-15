# VHS Tape Script for pi-fusion
# Generate the demo GIF by running: vhs demo.tape

Output docs/assets/demo.gif

Set Shell "bash"
Set FontSize 14
Set FontFamily "JetBrains Mono"
Set Width 1200
Set Height 620
Set Theme "Catppuccin Macchiato"

# Start the pi session
Type "pi"
Enter
Sleep 2s

# Configure and enable the fast preset
Type "/fusion preset fast"
Enter
Sleep 1s

Type "/fusion on"
Enter
Sleep 1s

# Trigger a fused turn with a complex problem
Type "Find the signature verification bypass bug in webhook.py"
Enter

# Let the parallel workers stream and complete their planning phase
Sleep 12s

# Focus first worker column
Type "1"
Sleep 2s

# Focus second worker column
Type "2"
Sleep 2s

# Return to split view
Type "0"
Sleep 2s

# Exit
Ctrl+D
Sleep 1s
