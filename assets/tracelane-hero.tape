# tracelane README hero GIF — terminal portion.
#
# Records the `npx @tracelane/cli init` wedge-amplifier flow against a real
# (pre-staged) WebdriverIO fixture. Output: assets/tracelane-hero.gif
#
# Run via: bash assets/record-tracelane-hero.sh
# (the script stages the fixture + invokes vhs — don't run vhs directly)
#
# The recording shows: a WDIO project without tracelane → one command
# wires it → the config diff. Does NOT actually run wdio inside the tape
# (Chrome+chromedriver capture in vhs is flaky and Gate B7's static
# /demo report already covers the "see a real report" side of the value
# prop).

Output "tracelane-hero.gif"

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

# Show the project skeleton — viewer sees a plain WDIO project, no tracelane.
Type "ls"
Enter
Sleep 1200ms

Type "cat package.json | jq '.devDependencies'"
Enter
Sleep 2000ms

# The one-command install.
Type "npx @tracelane/cli init --yes"
Enter
Sleep 5500ms

# Confirm tracelane is now wired in the config.
Type "grep -A2 services: wdio.conf.ts"
Enter
Sleep 2200ms

# And the reports dir exists + is gitignored.
Type "ls -la tracelane-reports/ && grep tracelane .gitignore"
Enter
Sleep 2200ms

# Final pause for the last frame.
Sleep 1500ms
