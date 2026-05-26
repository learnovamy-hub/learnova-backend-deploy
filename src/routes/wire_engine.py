import re

path = r"C:\Users\Yong\OneDrive\learnova\learnova-backend\learnova-backend\src\routes\tutor.js"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add import after line 4 (after supabase import)
old_import = "import { supabase } from '../config/database.js';"
new_import = """import { supabase } from '../config/database.js';
import { PedagogyEngine, buildMasterSystemPrompt } from '../pedagogy/index.js';"""

content = content.replace(old_import, new_import, 1)

# 2. Add engine initialisation after anthropic client line
old_anthropic = "const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });"
new_anthropic = """const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// Learnova Pedagogy Engine - initialised once, shared across all requests
const pedagogyEngine = new PedagogyEngine(supabase);"""

content = content.replace(old_anthropic, new_anthropic, 1)

# 3. Replace all 3 buildLayeredSystemPrompt calls with buildMasterSystemPrompt
# The new function accepts the same params - just swap the name
content = content.replace("buildLayeredSystemPrompt(", "buildMasterSystemPrompt(", )

# 4. Write back
with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Done")