path = r"C:\Users\Yong\OneDrive\learnova\learnova-backend\learnova-backend\src\pedagogy\prompt_builder.js"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# The join got broken across lines - fix it
# Find and replace the broken pattern
broken = '  ].filter(l => l && l.trim().length > 0).join("\n\n").trim();\n}'
fixed  = '  ].filter(l => l && l.trim().length > 0).join("\\n\\n").trim();\n}'

if broken in content:
    content = content.replace(broken, fixed)
    print("Fixed join line")
else:
    # Show exact bytes around line 71
    lines = content.split("\n")
    for i, l in enumerate(lines[68:76], start=69):
        print(f"{i}: {repr(l)}")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)