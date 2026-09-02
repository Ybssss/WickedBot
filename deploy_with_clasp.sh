#!/bin/bash
# clasp push and deploy for WickedBot
cd "C:\Users\YB\Projects\WickedBot"

echo "=== Step 1: Verify clasp installed ==="
clasp --version

echo ""
echo "=== Step 2: Login (one-time) ==="
echo "If you have NOT run 'clasp login' before, run it now in a separate terminal:"
echo "  clasp login"
echo "It will open a browser. Sign in with the Google account that owns the GAS project."
echo ""
echo "=== Step 3: Verify .clasp.json ==="
if [ -f .clasp.json ]; then
    echo "OK: .clasp.json exists"
    cat .clasp.json
else
    echo "Creating .clasp.json from .clasp.json.example..."
    cp .clasp.json.example .clasp.json
    echo "Edit .clasp.json and replace YOUR_SCRIPT_ID_HERE with:"
    echo "  1Z9rSsI4eR5yilleNLCylZopS8BrDGfI5dm4s17U1kL6wyzkcA5qNnWla"
fi

echo ""
echo "=== Step 4: Push files to GAS ==="
clasp push

echo ""
echo "=== Step 5: Redeploy web app ==="
clasp deploy -d "fix em-dash and register commands" --versionNumber 1

echo ""
echo "=== Step 6: Open the script in browser ==="
clasp open-script-url
