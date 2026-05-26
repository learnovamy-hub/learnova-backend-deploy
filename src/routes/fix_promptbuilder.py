path = r"C:\Users\Yong\OneDrive\learnova\learnova-backend\learnova-backend\src\pedagogy\prompt_builder.js"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix the broken ternary with newline in string literal
old = '''    failureTier > 0 ? "=== CURRENT FAILURE STATE ===\\n" + failureInstruction : "",'''
new = '''    failureTier > 0 ? ("=== CURRENT FAILURE STATE ===" + "\\n" + failureInstruction) : "",'''

if old in content:
    content = content.replace(old, new)
    print("Fixed ternary line")
else:
    # Try alternate form
    old2 = 'failureTier > 0 ? "=== CURRENT FAILURE STATE ===\n" + failureInstruction : "",'
    new2 = 'failureTier > 0 ? ("=== CURRENT FAILURE STATE ===" + "\\n" + failureInstruction) : "",'
    if old2 in content:
        content = content.replace(old2, new2)
        print("Fixed ternary line (alternate)")
    else:
        print("Pattern not found - printing lines around 65-75:")
        lines = content.split("\n")
        for i, l in enumerate(lines[62:75], start=63):
            print(f"{i}: {repr(l)}")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)