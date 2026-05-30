# peek README hero GIF — terminal portion.
#
# Records `peek sessions list` followed by `peek sessions show ... --format markdown`
# against a pre-seeded fixture sessions.db at $HOME/.peek/sessions.db.
# Output: assets/peek-hero.gif
#
# Run via: bash assets/record-peek-hero.sh
# (the script builds peek-cli from the monorepo, seeds the fixture DB, and
# invokes vhs — do NOT run vhs directly.)
#
# The recording shows the read side of peek's value: a browser session
# (recorded locally by the extension) appears as a queryable, structured
# artifact your AI agent (or you, via the CLI) can drill into. The install
# half (`npx peek init`) is covered in the README install code block; the
# init flow is interactive (multiSelect prompts) and doesn't record cleanly
# inside the 15-second hero budget.

Output "peek-hero.gif"

Set FontSize 14
Set Width 1200
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 60ms
Set Margin 20
Set MarginFill "#1e1e2e"
Set BorderRadius 10

Hide
Type "clear"
Enter
Show

Sleep 700ms

# List the recently-recorded sessions on this machine.
Type "peek sessions list"
Enter
Sleep 2800ms

# Drill into one of them, formatted as markdown (AI-ready).
Type "peek sessions show s_demo_checkout --format markdown"
Enter
Sleep 5500ms

# Show the JSON envelope shape too, for the AI-agent path.
Type "peek sessions show s_demo_checkout --format json | head -28"
Enter
Sleep 4000ms

# Final pause for the last frame.
Sleep 1200ms
