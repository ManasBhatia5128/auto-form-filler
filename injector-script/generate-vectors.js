import { readFile, writeFile } from 'fs/promises';
import path from 'path';

async function generateVectors() {
  console.log("Starting data enrichment (generating backup keywords using LLM)...");

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

  if (!endpoint || !apiKey) {
    console.error("Error: Missing Azure OpenAI Chat Completion environment variables in .env");
    console.error("Ensure AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are set.");
    process.exit(1);
  }

  const targetUri = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const profilePath = path.join(process.cwd(), 'injector-script', 'profile.json');
  const outputPath = path.join(process.cwd(), 'extension', 'profile-enhanced.json');

  let profileData;
  try {
    const fileContent = await readFile(profilePath, 'utf-8');
    profileData = JSON.parse(fileContent);
  } catch (error) {
    console.error(`Failed to read profile.json from ${profilePath}:`, error.message);
    process.exit(1);
  }

  const entries = Object.entries(profileData);
  console.log(`Found ${entries.length} fields to process.`);

  for (const [key, fieldData] of entries) {
    console.log(`Generating additional keywords for: "${key}"...`);

    const prompt = `You are a data assistant helping to auto-fill forms. 
For the field with key: "${key}" and actual values: ${JSON.stringify(fieldData.actual_value)}, 
generate a list of up to 10 additional, relevant backup keywords or synonyms that a form might use for this field.
Ensure they are unique and not already in this list: ${JSON.stringify(fieldData.backup_keywords)}.
Return ONLY a valid JSON array of strings, with no markdown formatting and no extra text.`;

    try {
      const response = await fetch(targetUri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Azure API Error (${response.status}): ${errText}`);
      }

      const responseData = await response.json();
      let generatedText = responseData.choices[0].message.content.trim();
      
      // Cleanup markdown if LLM includes it
      if (generatedText.startsWith('```json')) {
        generatedText = generatedText.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (generatedText.startsWith('```')) {
        generatedText = generatedText.replace(/^```\n/, '').replace(/\n```$/, '');
      }

      let newKeywords = [];
      try {
        newKeywords = JSON.parse(generatedText);
        if (!Array.isArray(newKeywords)) {
           newKeywords = [];
        }
      } catch (e) {
        console.error(`Failed to parse LLM response for ${key}: ${generatedText}`);
      }

      // Merge and deduplicate keywords
      const allKeywords = new Set([
        ...fieldData.backup_keywords.map(k => k.toLowerCase()),
        ...newKeywords.map(k => String(k).toLowerCase())
      ]);

      fieldData.backup_keywords = Array.from(allKeywords);
      // Ensure ai_coordinates is removed since we no longer use vectors
      if (fieldData.ai_coordinates) {
        delete fieldData.ai_coordinates;
      }
      
      console.log(`  -> Added ${newKeywords.length} new keywords. Total keywords: ${fieldData.backup_keywords.length}`);
      
      // Respect rate limits: small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`  -> Error generating keywords for ${key}:`, error.message);
      // We'll continue even if one fails
    }
  }

  // Ensure extension directory exists
  const fs = await import('fs');
  const extDir = path.dirname(outputPath);
  if (!fs.existsSync(extDir)) {
    fs.mkdirSync(extDir, { recursive: true });
  }

  try {
    await writeFile(outputPath, JSON.stringify(profileData, null, 2), 'utf-8');
    console.log(`\nSuccessfully generated profile-enhanced.json and saved to: ${outputPath}`);
  } catch (error) {
    console.error(`Failed to write output file:`, error.message);
    process.exit(1);
  }
}

generateVectors();
