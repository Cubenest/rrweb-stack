# tracelane README hero GIF — terminal portion.
#
# Records install + run + report-written sequence as a GIF for the
# packages/tracelane-wdio/README.md hero. Output: assets/tracelane-hero.gif
#
# PREREQ: vhs installed (brew install vhs OR see https://github.com/charmbracelet/vhs)
#
# PREREQ: fixture project staged at ../tmp/tracelane-hero-demo/ — a real
# WDIO project with @tracelane/wdio in devDeps and a deliberately-failing
# spec at test/specs/login.e2e.ts. The simplest way to stage one:
#
#   mkdir -p /tmp/tracelane-hero-demo
#   cd /tmp/tracelane-hero-demo
#   npm init -y
#   npm install --save-dev @wdio/cli @wdio/local-runner @wdio/mocha-framework \
#                          webdriverio @tracelane/wdio
#   # Edit wdio.conf.ts to add the TraceLaneService — see the package README
#   # Add a deliberately-failing spec at test/specs/login.e2e.ts
#   # Confirm `npx wdio run wdio.conf.ts` writes a report
#
# Then from the rrweb-stack repo root:
#   cd /tmp/tracelane-hero-demo && vhs ${OLDPWD}/assets/tracelane-hero.tape
#
# The output GIF lands at ${OLDPWD}/assets/tracelane-hero.gif (i.e. inside
# the rrweb-stack repo, ready to commit).

Output ../tracelane-hero.gif

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

Sleep 800ms

# Show the project layout
Type "ls"
Enter
Sleep 1500ms

# Install
Type@80ms "npm install --save-dev @tracelane/wdio"
Enter
Sleep 1200ms
# (in the staged demo the package is already installed, so this is fast)

# Show the conf change (annotated)
Type "# In wdio.conf.ts: services: [[TraceLaneService, { mode: 'failed' }]]"
Enter
Sleep 1500ms

# Run the suite
Type@80ms "npx wdio run wdio.conf.ts"
Enter
Sleep 6500ms

# Pause on the failed-test + report-written summary
Sleep 1500ms

# Show the produced report
Type "ls tracelane-reports/"
Enter
Sleep 2500ms

# Final pause so the last frame is readable
Sleep 1500ms
