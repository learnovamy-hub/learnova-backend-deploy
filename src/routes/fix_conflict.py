path = r"C:\Users\Yong\OneDrive\learnova\learnova-backend\learnova-backend\src\routes\tutor.js"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Rename the local legacy function to _legacyBuildPrompt so it does not clash
# with the imported buildMasterSystemPrompt from pedagogy engine
content = content.replace(
    "function buildMasterSystemPrompt({ role, subject, topic, standardContext,",
    "function _legacyBuildPrompt({ role, subject, topic, standardContext,"
)

# Also rename any internal call to the legacy function if it calls itself
# (the 3 external calls at 625, 734, 749 should remain as buildMasterSystemPrompt)
# The legacy function definition calls lines.push(PEDAGOGY_RULES) internally
# so we just need to make sure the function definition name is different

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Done")