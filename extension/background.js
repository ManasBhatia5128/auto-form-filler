// Configuration (Hardcoded for local extension since Chrome extensions don't have process.env)

const TARGET_URI = `${AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;

let profileData = null;

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(loadProfile);
chrome.runtime.onStartup.addListener(loadProfile);

async function loadProfile() {
  try {
    const url = chrome.runtime.getURL('profile-enhanced.json');
    const response = await fetch(url);
    if (response.ok) {
      profileData = await response.json();
      console.log("Successfully loaded profile-enhanced.json into memory.");
    } else {
      console.error("Failed to load profile-enhanced.json", response.status);
    }
  } catch (error) {
    console.error("Error reading profile:", error);
  }
}

// Listen for requests from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "FIND_MATCH") {
    handleFindMatch(message.questionText).then(sendResponse);
    return true; // Indicates async response
  }
});

async function handleFindMatch(questionText) {
  if (!profileData) {
    await loadProfile();
    if (!profileData) return { match: null }; // Still failed
  }

  // Create a simplified prompt context
  const contextData = {};
  for (const key in profileData) {
    contextData[key] = {
      actual_value: profileData[key].actual_value,
      backup_keywords: profileData[key].backup_keywords
    };
  }

  const systemPrompt = `You are an AI assistant designed to accurately map form questions to known user data. 
You are given a JSON object containing the user's available fields. Each field has an "actual_value" (an array of possible formats for the value) and "backup_keywords" (synonyms/hints for what the field represents).

Your task: Given a question from a form, determine which field it represents based on the backup_keywords and the context.
If you find a strong match, return a JSON object with the "match" property containing the "actual_value" array of that field, and a "score" (a float between 0.0 and 1.0 indicating confidence).
If no field matches the question reasonably well, return {"match": null, "score": 0.0}.

CRITICAL: Return ONLY a valid JSON object. Do not include markdown formatting or any other text.`;

  const userMessage = `Form Question: "${questionText}"
User Data: ${JSON.stringify(contextData)}`;

  try {
    const response = await fetch(TARGET_URI, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1
      })
    });
    
    if (!response.ok) {
      console.error("Azure API Error:", await response.text());
      return { match: null };
    }
    
    const data = await response.json();
    let generatedText = data.choices[0].message.content.trim();
    
    // Cleanup markdown if LLM includes it
    if (generatedText.startsWith('```json')) {
      generatedText = generatedText.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (generatedText.startsWith('```')) {
      generatedText = generatedText.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    const result = JSON.parse(generatedText);
    
    if (result.match && result.score >= 0.7) {
      console.log(`Matched "${questionText}" -> ${JSON.stringify(result.match)} (Score: ${result.score})`);
      return { match: result.match, score: result.score };
    } else {
      console.log(`No strong match for "${questionText}". Result was:`, result);
      return { match: null, score: result.score || 0 };
    }
    
  } catch (error) {
    console.error("Error calling LLM for match:", error);
    return { match: null };
  }
}
