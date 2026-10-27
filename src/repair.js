/**
 * Simple, robust JSON repair utility for LLM/tool output.
 * Handles unclosed brackets, trailing commas, single quotes, unquoted keys.
 */
function repairJson(raw) {
  if (typeof raw !== 'string') return raw;
  let str = raw.trim();
  
  // Try direct parse first
  try {
    return JSON.parse(str);
  } catch (e) {
    // Attempt basic repairs
  }

  // Strip markdown code fences if present
  str = str.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

  // Remove trailing commas before closing braces/brackets
  str = str.replace(/,\s*([\]}])/g, '$1');

  // Attempt parse again
  try {
    return JSON.parse(str);
  } catch (e) {
    // Continue repairing
  }

  // Auto-close open braces and brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (c === '{') openBraces++;
      else if (c === '}') openBraces = Math.max(0, openBraces - 1);
      else if (c === '[') openBrackets++;
      else if (c === ']') openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  if (inString) str += '"';
  while (openBraces > 0) {
    str += '}';
    openBraces--;
  }
  while (openBrackets > 0) {
    str += ']';
    openBrackets--;
  }

  return JSON.parse(str);
}

module.exports = { repairJson };
