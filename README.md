# **CV Genie ✨** [Live Demo](https://cvgenie.pages.dev/)

CV Genie is a powerful, AI-driven application that transforms a user's LinkedIn profile data into a professional, ATS-friendly CV tailored for a specific job title. The application is built using a serverless architecture with Cloudflare Workers for the backend and Cloudflare Pages for the frontend.

The backend worker leverages the Google Gemini API for advanced text analysis and content curation and uses Puppeteer via Browser Rendering to generate a polished PDF document.

## **Features**

* **AI-Powered Content Curation**: Uses Google's Gemini model to parse, analyze, and rewrite CV content to be concise and impactful.  
* **Tailored for Job Applications**: Customizes the generated CV based on a target job title, highlighting the most relevant skills and experiences.  
* **Multiple Data Inputs**: Accepts LinkedIn data via direct text paste, .txt file upload, or by processing PDF and image files using client-side OCR (Tesseract.js).  
* **High-Quality PDF Generation**: Utilizes Cloudflare's Browser Rendering (Puppeteer) to create a clean, professional PDF from structured HTML.  
* **Serverless & Scalable**: Built entirely on the Cloudflare ecosystem, making it highly scalable and cost-effective.  
* **Dark/Light Mode**: A sleek user interface with theme switching.

## **How It Works**

1. **Frontend (Cloudflare Pages)**: The user inputs their Gemini API key, personal details, and LinkedIn profile data (as text, PDF, or images) into a static HTML page. Client-side JavaScript processes any files (using Tesseract.js for OCR) and bundles everything into a JSON payload.  
2. **API Call**: The frontend sends the payload to a dedicated API endpoint on the Cloudflare Worker.  
3. **Backend (Cloudflare Worker)**:  
   * The worker receives the request.  
   * It calls the Gemini API twice: first to **extract** structured data from the raw text, and a second time to **curate** and rewrite that data, tailoring it for the target job title.  
   * The curated JSON data is converted into a well-formatted HTML document.  
   * The worker invokes the **Browser Rendering** service, passing it the HTML. Puppeteer launches a headless browser, renders the HTML, and generates a PDF.  
   * The final PDF is streamed back to the user for download.

## **Prerequisites**

Before you begin, ensure you have the following:

* A **Cloudflare account**. You can [sign up for free](https://www.google.com/search?q=https://dash.cloudflare.com/sign-up).  
* **Node.js** and **npm** installed on your machine.  
* Cloudflare's command-line tool, **Wrangler**, installed globally.  
```
  npm install \-g wrangler
```
* **Git** installed on your machine.  
* A **Google Gemini API Key**. You can get one from [Google AI Studio](https://ai.google.dev/).

## **Setup Instructions**

Follow these steps to deploy your own version of CV Genie.

### **Step 1: Clone the Repository**

First, clone this repository to your local machine.
```
git clone \<your-repository-url\>  
cd \<repository-name\>
```
The project contains two main parts:

* index.html: The frontend application.  
* index.ts, package.json, etc.: The backend Cloudflare Worker (assuming they are in a worker subdirectory or similar).

### **Step 2: Configure and Deploy the Cloudflare Worker**

The worker handles all the backend logic, including API calls and PDF generation.

1. **Navigate to the Worker Directory**:  
   \# If your worker files are in a sub-directory, e.g., 'worker'
   ```
   cd worker
   ```
    
3. **Install Dependencies**:  
```
   npm install
```
   This will install Hono, the Google Generative AI SDK, Puppeteer, and other required packages from your package.json.  
5. Authenticate Wrangler:  
   Log Wrangler into your Cloudflare account.  
```
    wrangler login
```
6. Configure wrangler.toml:  
   Your worker's wrangler.toml file needs a special binding to use the Browser Rendering API. Add the following browser binding.  
```
   \# wrangler.toml  
   name \= "cv-generator-worker" \# Choose a unique name for your worker  
   main \= "src/index.ts"       \# Adjust path to your main worker file if needed  
   compatibility\_date \= "2024-03-22"

   \[vars\]  
   \# You can add environment variables here if needed

   \# Add this section for Puppeteer/Browser Rendering  
   \[\[browser\]\]  
   binding \= "MY\_BROWSER"
```
   The binding \= "MY\_BROWSER" line is critical. It tells Cloudflare to provide your worker with an object (MY\_BROWSER) that can control a headless browser instance. Your index.ts code already uses this binding.  
7. Deploy the Worker:  
   Publish your worker to the Cloudflare network.  
```
   wrangler deploy
```
   After deployment, Wrangler will output your worker's URL (e.g., https://cv-generator-worker.your-subdomain.workers.dev). **Copy this URL.**

### **Step 3: Configure and Deploy the Frontend on Cloudflare Pages**

The frontend is the index.html file that users will interact with.

1. Update the Worker URL in the Frontend:  
   Open the index.html file and find the fetch call inside the \<script\> tag. Replace the hardcoded URL with the URL of the worker you just deployed.  
 ```
   // Inside index.html

   // Find this line:  
   // Replace it with your worker's URL:  
   const response \= await fetch('https://YOUR\_WORKER\_NAME.YOUR\_SUBDOMAIN.workers.dev/api/generate', {  
       // ...  
   });
```
   Save the file after making this change.  
2. Deploy to Cloudflare Pages:  
   You can deploy your frontend by connecting your GitHub repository to Cloudflare Pages.  
   * Go to your Cloudflare Dashboard \-\> **Workers & Pages**.  
   * Select the **Pages** tab and click **Create application**.  
   * Choose **Connect to Git**.  
   * Select your forked repository.  
   * In the **Build settings**, you can leave the fields blank or select "None" for the framework preset, as index.html requires no build step. The **Root Directory** should be /.  
   * Click **Save and Deploy**.

Cloudflare will deploy your index.html and give you a unique URL (e.g., https://your-project.pages.dev). **Copy this URL.**

### **Step 4: Configure CORS**

To allow your frontend application to make requests to your backend worker, you must update the CORS (Cross-Origin Resource Sharing) settings in the worker code.

1. Edit the Worker Code:  
   Open your worker's main file (index.ts). Find the CORS\_ORIGIN constant at the top of the file.
   ```
   // Inside index.ts
   // Find this line:  
   // Replace it with your Cloudflare Pages URL:  
   const CORS\_ORIGIN \= "\[https://your-project.pages.dev\](https://your-project.pages.dev)";
   ```
3. Re-deploy the Worker:  
   After saving the change, re-deploy your worker for the new CORS policy to take effect.  
   \# From your worker directory  
```
   wrangler deploy
```
**Congratulations\!** Your application is now fully deployed and configured. Visit your Cloudflare Pages URL to start using it.
