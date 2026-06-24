// services/resumeCompressor.js
// Called only when resumeText.length > 14000 chars
// Summarizes overflow while preserving all scoreable fields using the project's OpenAI setup

const { getOpenAI, getModel } = require('../config/ai');

async function compressResumeText(resumeText) {
  const openai = getOpenAI();
  if (!openai) {
    console.warn('[COMPRESSOR] OpenAI not configured — skipping resume compression');
    return resumeText.substring(0, 14000); // fallback to truncate
  }

  const model = getModel();
  console.log(`[COMPRESSOR] Compressing long resume text (${resumeText.length} chars) using model ${model}`);

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [{
        role: 'user',
        content: `The following resume text is too long for direct processing.
Compress it to under 4000 words while preserving ALL of the following without loss:
- Full name, email, phone, location
- Every job title, company name, start date, end date, duration
- All skills, tools, technologies, frameworks mentioned anywhere
- All educational degrees, institutions, years
- All project names, tech stacks, key outcomes
- All certifications, achievements
- Notice period and expected salary if mentioned

Do NOT summarize or omit any of the above fields.
You may compress verbose descriptions, but never remove factual data.

RESUME TEXT:
${resumeText}`
      }],
      temperature: 0.1
    });

    const resultText = response.choices[0]?.message?.content;
    if (!resultText) {
      throw new Error('Empty response from OpenAI compressor');
    }

    console.log(`[COMPRESSOR] Successful compression. Original: ${resumeText.length} chars, compressed: ${resultText.length} chars`);
    return resultText;
  } catch (error) {
    console.error(`[COMPRESSOR] Failed to compress resume: ${error.message}. Falling back to substring.`);
    return resumeText.substring(0, 14000);
  }
}

module.exports = { compressResumeText };
