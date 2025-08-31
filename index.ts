import { GoogleGenerativeAI } from "@google/generative-ai";
import puppeteer from "@cloudflare/puppeteer";

export interface Env {
  MY_BROWSER: Fetcher;
}

const CORS_ORIGIN = "[https://your-project.pages.dev](https://your-project.pages.dev)";
const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// --- Type Definitions ---
type InlineData = {
    mimeType: string;
    data: string; // base64 encoded
};

type RequestPayload = {
    geminiApiKey: string;
    geminiModel: string;
    targetJobTitle: string;
    profilePhoto: InlineData;
    linkedinData: string;
    personalDetails: {
        email?: string;
        phone?: string;
        location?: string;
        summary?: string;
    };
    urls: {
        linkedinUrl?: string;
        githubUrl?: string;
        portfolioUrl?: string;
    }
};

async function handleOptions(request: Request) {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null
  ) {
    return new Response(null, { headers: corsHeaders });
  } else {
    return new Response(null, { headers: { Allow: "POST, OPTIONS" } });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }
    
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/generate") {
      try {
        if (request.headers.get("Content-Type") !== "application/json") {
             return new Response(JSON.stringify({ error: "Expected application/json" }), { status: 415, headers: corsHeaders });
        }
          
        const payload = await request.json<RequestPayload>();
        const { geminiApiKey, geminiModel, targetJobTitle, profilePhoto, linkedinData, personalDetails, urls } = payload;
        const { linkedinUrl, githubUrl, portfolioUrl } = urls;

        if (!geminiApiKey || !geminiModel || !targetJobTitle || !profilePhoto) {
          return new Response(JSON.stringify({ error: "Missing required payload fields." }), { status: 400, headers: corsHeaders });
        }

        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: geminiModel });
        
        const extractedJson = await extractData(linkedinData, model);

        if (personalDetails.email) extractedJson.contactInfo.email = personalDetails.email;
        if (personalDetails.phone) extractedJson.contactInfo.phone = personalDetails.phone;
        if (personalDetails.location) extractedJson.contactInfo.location = personalDetails.location;

        const curatedJson = await curateData(extractedJson, targetJobTitle, personalDetails.summary, model);
        
        if (curatedJson.contactInfo) {
            if (linkedinUrl) curatedJson.contactInfo.linkedin = linkedinUrl;
            if (githubUrl) curatedJson.contactInfo.github = githubUrl;
            if (portfolioUrl) curatedJson.contactInfo.portfolio = portfolioUrl;
        }

        const pdf = await generatePdf(curatedJson, profilePhoto, env.MY_BROWSER);
        
        const responseHeaders = new Headers(corsHeaders);
        responseHeaders.set("Content-Type", "application/pdf");
        responseHeaders.set("Content-Disposition", 'attachment; filename="CV_Genie.pdf"');

        return new Response(pdf, { headers: responseHeaders });

      } catch (error) {
        console.error("Error in /api/generate:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        return new Response(JSON.stringify({ error: `Backend Error: ${errorMessage}` }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

// --- Agent Implementations ---

async function extractData(text: string, model: any): Promise<any> {
    const prompt = `
    You are a precise CV parsing agent. Analyze the unstructured text and convert it into a structured JSON object. Adhere strictly to the JSON schema. If information is missing, omit the key.

    CRITICAL: Escape special characters like double quotes (") with a backslash (\\") to ensure valid JSON output.

    JSON Schema:
    - name: string
    - title: string
    - contactInfo: { email: string, phone: string, location: string }
    - summary: string
    - workExperience: [{ title: string, company: string, location: string, dates: string, description: string[] }]
    - education: [{ institution: string, degree: string, dates: string }]
    - skills: string[]
    - projects: [{ name: string, description: string, url?: string }]
    - certifications: [{ name: string, issuer: string, date?: string }]

    Provide ONLY the clean JSON object.
    Text:
    ---
    ${text}
    ---
    `;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let jsonText = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonText);
}

// NEW: Heavily modified curation agent with much stricter instructions
async function curateData(fullJson: any, targetJobTitle: string, userSummary: string | undefined, model: any): Promise<any> {
    const prompt = `
    You are an expert career storyteller and CV editor. Your task is to transform a comprehensive JSON data object into a highly focused, concise, and impactful CV tailored for the role of "${targetJobTitle}". Your guiding principles are relevance and brevity.

    Follow these rules meticulously:

    1.  **Filter All Sections**: Review every section (workExperience, projects, certifications, education). Retain ONLY the items that are demonstrably relevant to a "${targetJobTitle}". If a section (e.g., certifications) contains no relevant items, omit the entire section from the final output.

    2.  **Rewrite and Summarize Aggressively**: You must rewrite, not just copy. Your goal is to create a compelling narrative.
        * **Work Experience**: For each relevant job, distill the description into a maximum of **two** powerful bullet points. Each bullet must showcase a quantifiable achievement or a skill directly related to the target job.
        * **Projects**: For each relevant project, write a **single sentence (1-2 lines max)** describing its outcome and the key skill demonstrated that is valuable for a "${targetJobTitle}".
        * **Certifications**: For each relevant certification, write a single line explaining its value or the core competency it represents.

    3.  **Categorize Skills**: Analyze all skills from the source. Organize the most relevant ones into logical categories. The output for the 'skills' key MUST be an object. Example categories: "Technical Skills", "Languages", "Cloud Platforms", "Soft Skills". Only create categories that have skills to populate them.

    4.  **Craft the Professional Summary**: If a user-provided summary exists, refine it to be a powerful 2-3 sentence pitch. If not, create a new summary from scratch based on the most impressive, relevant highlights from the candidate's history.

    5.  **Final Output**: Return ONLY a valid JSON object with the refined content. The schema must be the same as the input, with the 'skills' key being an object of string arrays.

    **User-Provided Summary (use as a base if available):**
    ---
    ${userSummary || "Not provided."}
    ---

    **Full JSON data to filter, rewrite, and summarize:**
    ---
    ${JSON.stringify(fullJson, null, 2)}
    ---
    `;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let jsonText = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonText);
}


async function generatePdf(data: any, photo: InlineData, browserBinding: Fetcher): Promise<ArrayBuffer> {
    const photoDataUrl = `data:${photo.mimeType};base64,${photo.data}`;
    const html = generateCvHtml(data, photoDataUrl);
    
    let browser = null;
    try {
        browser = await puppeteer.launch(browserBinding);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
        });
        return pdfBuffer;
    } finally {
        if (browser) await browser.close();
    }
}

function generateCvHtml(data: any, photoDataUrl: string): string {
    const { name, title, contactInfo, summary, workExperience, education, skills, projects, certifications } = data;
    
    const renderList = (items: string[]) => items ? `<ul class="job-description">${items.map(item => `<li>${item}</li>`).join('')}</ul>` : '';
    
    const renderCategorizedSkills = (skillsObject: { [key: string]: string[] }) => {
        if (!skillsObject || Object.keys(skillsObject).length === 0) return '';
        let html = '';
        for (const category in skillsObject) {
            html += `
                <div class="skill-category">
                    <h4>${category}</h4>
                    <p>${skillsObject[category].join(' &bull; ')}</p>
                </div>`;
        }
        return html;
    };

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>CV for ${name}</title>
        <style>
            body { font-family: Arial, Helvetica, sans-serif; line-height: 1.4; color: #333333; background-color: #ffffff; margin: 0; padding: 0; }
            .cv-container { max-width: 800px; margin: 0 auto; padding: 10mm; }
            .cv-header { display: flex; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #3498db; padding-bottom: 20px;}
            .header-text { flex-grow: 1; }
            .profile-photo { width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-left: 20px; }
            .header-text h1 { font-size: 22pt; color: #2c3e50; margin: 0 0 5px 0; font-weight: 600; }
            .contact-line { font-size: 11pt; color: #555; margin-top: 10px; }
            .contact-line a { color: #3498db; text-decoration: none; }
            .contact-line a:hover { text-decoration: underline; }
            .section { margin-bottom: 15px; }
            .section h2 { font-size: 14pt; color: #34495e; border-bottom: 2px solid #3498db; padding-bottom: 5px; margin: 0 0 15px 0; }
            .entry { margin-bottom: 15px; }
            .entry-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
            .entry-header h3 { font-size: 12pt; margin: 0; font-weight: bold; }
            .entry-header .dates { font-size: 11pt; color: #555; font-style: italic; }
            .sub-header { font-size: 11pt; font-weight: normal; margin: 0 0 8px 0; }
            .job-description { margin: 0; padding-left: 20px; font-size: 11pt; }
            .job-description li { margin-bottom: 5px; }
            .skills-section { padding: 0; margin: 0; }
            .skill-category { margin-bottom: 10px; }
            .skill-category h4 { margin: 0 0 5px 0; font-size: 11pt; font-weight: bold; color: #34495e; }
            .skill-category p { margin: 0; font-size: 11pt; }
        </style>
    </head>
    <body>
        <div class="cv-container">
            <div class="cv-header">
                <div class="header-text">
                    ${name ? `<h1>${name}</h1>` : ''}
                    <div class="contact-line">
                        ${contactInfo?.location ? `<span>${contactInfo.location}</span>` : ''}
                        ${contactInfo?.phone ? `<span> &bull; ${contactInfo.phone}</span>` : ''}
                        ${contactInfo?.email ? `<span> &bull; <a href="mailto:${contactInfo.email}">${contactInfo.email}</a></span>` : ''}
                        ${contactInfo?.linkedin ? `<span> &bull; <a href="${contactInfo.linkedin}" target="_blank">LinkedIn</a></span>` : ''}
                        ${contactInfo?.github ? `<span> &bull; <a href="${contactInfo.github}" target="_blank">GitHub</a></span>` : ''}
                        ${contactInfo?.portfolio ? `<span> &bull; <a href="${contactInfo.portfolio}" target="_blank">Portfolio</a></span>` : ''}
                    </div>
                </div>
                <img src="${photoDataUrl}" alt="Profile photo of ${name}" class="profile-photo">
            </div>

            ${summary ? `<div class="section"><h2>Summary</h2><p style="font-size: 11pt;">${summary}</p></div>` : ''}

            ${skills && Object.keys(skills).length > 0 ? `<div class="section"><h2>Skills</h2><div class="skills-section">${renderCategorizedSkills(skills)}</div></div>` : ''}

            ${workExperience && workExperience.length > 0 ? `
            <div class="section">
                <h2>Work Experience</h2>
                ${workExperience.map(job => `
                    <div class="entry">
                        <div class="entry-header"><h3>${job.title}</h3><span class="dates">${job.dates}</span></div>
                        <p class="sub-header">${job.company} | ${job.location}</p>
                        ${job.description ? renderList(job.description) : ''}
                    </div>`).join('')}
            </div>` : ''}

            ${projects && projects.length > 0 ? `
            <div class="section">
                <h2>Projects</h2>
                ${projects.map(proj => `
                    <div class="entry">
                        <div class="entry-header"><h3>${proj.name}</h3></div>
                        <p class="sub-header">${proj.description} ${proj.url ? `(<a href="${proj.url}">Link</a>)` : ''}</p>
                    </div>`).join('')}
            </div>` : ''}

            ${certifications && certifications.length > 0 ? `
            <div class="section">
                <h2>Certifications</h2>
                ${certifications.map(cert => `
                    <div class="entry">
                       <p class="sub-header"><strong>${cert.name}</strong> - ${cert.issuer} ${cert.date ? `(${cert.date})` : ''}</p>
                    </div>`).join('')}
            </div>` : ''}
            
            ${education && education.length > 0 ? `
            <div class="section">
                <h2>Education</h2>
                ${education.map(edu => `
                    <div class="entry">
                        <div class="entry-header"><h3>${edu.institution}</h3><span class="dates">${edu.dates}</span></div>
                        <p class="sub-header">${edu.degree}</p>
                    </div>`).join('')}
            </div>` : ''}

        </div>
    </body>
    </html>
    `;
}