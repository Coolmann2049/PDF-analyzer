require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('node:fs');
const mime = require('mime-types');

const {
    GoogleGenerativeAI,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

const app = express();
const port = 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    },
});
const upload = multer({ storage: storage });

// --- Gemini API Helper Functions (Modified for Streaming) ---

async function uploadToGemini(path, mimeType) {
    const uploadResult = await fileManager.uploadFile(path, {
        mimeType,
        displayName: path,
    });
    const file = uploadResult.file;
    console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
    return file;
}

async function waitForFilesActive(files) {
    console.log("Waiting for file processing...");
    for (const name of files.map((file) => file.name)) {
        let file = await fileManager.getFile(name);
        while (file.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            file = await fileManager.getFile(name);
        }
        if (file.state !== "ACTIVE") {
            throw Error(`File ${file.name} failed to process`);
        }
    }
    console.log("...all files ready\n");
}

async function runTextTableImageInference(pdfPath) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash-thinking-exp-01-21",
        systemInstruction: "You are a financial analyst tasked with analyzing a financial document. Your goal is to extract all text, images, and tables, and then draw meaningful inferences from each.  Please follow this structure:\n\n**Text Understanding:**\n\n1. **Inferences:** [Provide detailed inferences based on the extracted text. Explain the meaning and significance of the text, focusing on financial implications. Be explicit and thorough in your analysis.]\n\n**Image Understanding:**\n\n1. **Inferences:** [Provide detailed inferences based on each image. Explain what the images represent and their financial significance.  Connect them to the extracted text inference where possible.]\n\n**Table Understanding:**\n\n1. **Inferences:** [Provide detailed inferences based on each table. Analyze the data within the tables, highlighting trends, patterns, and key financial insights. Explain the meaning and significance of the data in relation to the overall financial document.]\n\nDepending on the content provided in the PDF, you need to dynamically adjust the length of each section to make sure that sections with less content have less in output and sections with more content have more in output. Make sure you leave out irrelevent details in the document",
    });

    const generationConfig = {
        temperature: 0.7,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 65536,
        responseModalities: [],
        responseMimeType: "text/plain",
    };

    const mimeType = mime.lookup(pdfPath) || 'application/octet-stream';
    const files = [await uploadToGemini(pdfPath, mimeType)];
    await waitForFilesActive(files);

    const chatSession = model.startChat({
        generationConfig,
        history: [
            {
                role: "user",
                parts: [
                    {
                        fileData: {
                            mimeType: files[0].mimeType,
                            fileUri: files[0].uri,
                        },
                    },
                ],
            },
        ],
    });

    const result = await chatSession.sendMessageStream("Analyze this financial document and provide inferences as instructed in the system instruction.");
    return result; // Return the stream
}

async function runSWOTAnalysisStream(inferences) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: "You are a SWOT analysis master. You will be provided with inferences from a PDF. Your task is to perform a detailed SWOT analysis based on these inferences.  Please clearly separate your analysis into the following sections:\n\n**Strengths:**\n* [List and describe the strengths identified in the inferences.]\n\n**Weaknesses:**\n* [List and describe the weaknesses identified in the inferences.]\n\n**Opportunities:**\n* [List and describe the opportunities identified in the inferences.]\n\n**Threats:**\n* [List and describe the threats identified in the inferences.]\n\nInferences from the PDF will be provided",
    });

    const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseModalities: [],
        responseMimeType: "text/plain",
    };

    const chatSession = model.startChat({
        generationConfig,
        history: [
            {
                role: "user",
                parts: [{ text: `Okay, I have analyzed the document and here is the output:\n\nInferences:\n\n${inferences}` }],
            },
        ],
    });

    const result = await chatSession.sendMessageStream("Perform a SWOT analysis based on the provided inferences.");
    return result; // Return the stream
}

async function runCompetitorStrategyStream(inferences) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: "You are a competitive strategy manager. Your task is to analyze competitor's potential future strategies based on the provided inferences. Rely strongly on these inferences.\n\nInferences:\nWill be provided as text\nInstructions:\n\n    * Clearly and concisely describe the competitor's likely future strategy. Be specific, outlining the key actions they are likely to take.\n    * Analyze the potential impact of this predicted strategy on your own business.  Consider both the threats and opportunities it presents.  Be as detailed as possible in your analysis.\n    * Propose potential counter-strategies a business could employ to capitalize on the opportunities presented by the competitor's predicted strategy.  Again, be specific and actionable.",
    });

    const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseModalities: [],
        responseMimeType: "text/plain",
    };

    const chatSession = model.startChat({
        generationConfig,
        history: [
            {
                role: "user",
                parts: [{ text: `Okay, I have analyzed the document and here is the output:\n\nInferences:\n\n${inferences}` }],
            },
        ],
    });

    const result = await chatSession.sendMessageStream("Analyze the competitor's strategy based on the provided inferences.");
    return result; // Return the stream
}

async function runCompetitorProfileStream(inferences) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: "You are a Competitor Profiling Agent. Your task is to analyze provided inferences from a PDF document and create a comprehensive profile of a competitor company. The inferences are categorized as text, image, and table. Use ONLY the provided inferences to create the profile.\n\n**Instructions:**\n\n1. **Analyze Text Inferences:** Carefully examine the text inferences and extract key information related to the competitor's basic information (name, location, industry, etc.), products and services, market presence (target audience, market share, etc.), and sales (revenue, pricing strategies, etc.).\n\n2. **Analyze Image Inferences:**Examine the image inferences and extract any visual information that contributes to understanding the competitor's products, services, branding, target audience, or market presence. Describe the images and explain their relevance to the competitor's profile.\n\n3. **Analyze Table Inferences:**Analyze the table inferences and extract any structured data related to the competitor's products, services, pricing, sales figures, market share, or other relevant metrics. Clearly present the extracted data and its significance.\n\n4. **Combine Inferences:** Integrate the information extracted from text, image, and table inferences to create a cohesive and comprehensive competitor profile. Ensure that the profile covers the following aspects:\n\n* **Basic Information:** Company name, location, industry, history, etc.\n* **Products and Services:** Detailed description of offerings, key features, and competitive advantages.\n* **Market Presence:** Target audience, market share, geographical reach, marketing strategies, etc.\n* **Sales:** Revenue, pricing strategies, sales channels, customer base, etc.\n\n5. **Present the Profile:** Present the competitor profile in a clear and organized manner. Use headings and subheadings to structure the information logically. Use bullet points and concise language to present key findings.\n\n**Input:**\nWIll be provided as text.\n**Output:**\n\n```\n[Competitor Profile: Competitor Name]\n\n[Basic Information]\n* ...\n* ...\n\n[Products and Services]\n* ...\n* ...\n\n[Market Presence]\n* ...\n* ...\n\n[Sales]\n* ...\n* ...",
    });

    const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseModalities: [],
        responseMimeType: "text/plain",
    };

    const chatSession = model.startChat({
        generationConfig,
        history: [
            {
                role: "user",
                parts: [{ text: `output of the inference (stored in a variable)\n\n${inferences}` }],
            },
        ],
    });

    const result = await chatSession.sendMessageStream("Create a competitor profile based on the provided inferences.");
    return result; // Return the stream
}

async function runKeyAnalysisStream(swotOutput, strategyOutput, profileOutput) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash-thinking-exp-01-21",
        systemInstruction: "As a Competitive Analyst, your task is to generate a detailed key analysis of a competitor based on the provided SWOT analysis, competitor profile, and competitor strategy.  Ensure you incorporate all three provided analyses into your assessment.  Be specific and detailed in your approach.\n\nOutput your analysis in the following format:\n\n1. **Executive Summary:** Briefly summarize the key findings of your competitor analysis.\n\n2. **SWOT Analysis Breakdown:** Provide a detailed breakdown of the competitor's strengths, weaknesses, opportunities, and threats. Explain how each element impacts their competitive position. Will be provided as text and explicitely mentioned\n\n3. **Competitor Profile Analysis:** Analyze the competitor's profile, including their market positioning, target audience, product/service offerings, and key differentiators.  Relate this information to their competitive landscape. Will be provided in the form of text and explicitely mentioned\n\n4. **Competitor Strategy Analysis:** Analyze the competitor's overall strategy, including their marketing approach, sales tactics, and product development roadmap.  Assess the effectiveness of their strategy and potential challenges. Will be provided in the form of text and explicitely mentioned\n\n5. **Key Competitive Advantages and Disadvantages:** Summarize the competitor's key competitive advantages and disadvantages based on the combined insights from the SWOT analysis, competitor profile, and competitor strategy.\n\n6. **Recommendations:** Provide actionable recommendations on how to capitalize on the competitor's weaknesses and mitigate the risks posed by their strengths.\n\n\nEnsure your analysis is thorough, insightful, and data-driven.  Use the provided information to support your claims and conclusions.",
    });

    const generationConfig = {
        temperature: 0.7,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 65536,
        responseModalities: [],
        responseMimeType: "text/plain",
    };

    const chatSession = model.startChat({
        generationConfig,
        history: [
            {
                role: "user",
                parts: [
                    { text: `Here is the SWOT Analysis:\n\n${swotOutput}\n\nHere is the Competitor Profile:\n\n${profileOutput}\n\nHere is the Competitor Strategy:\n\n${strategyOutput}` },
                ],
            },
        ],
    });

    const result = await chatSession.sendMessageStream("Generate a key analysis based on the provided SWOT analysis, competitor profile, and competitor strategy.");
    return result; // Return the stream
}

async function runSummarizerStream(inferences) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: "You are a financial analyst tasked with summarizing a financial document based *solely* on provided inferences.  Your summary should not include any information directly from the document itself, only what can be derived from the inferences.\n\n**Instructions:**\n\n1. Combine the interpreted inferences into a single, detailed summary of the financial document.  Ensure the summary reflects the combined understanding derived from all inferences.\n2. Do not include any extra information in your summary.  Focus only on the provided inferences.\n\n**Inferences:**\n\nWill be provided as a text\n\n**Summary:**",
    });

    const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseModalities: [],
        responseMimeType: "text/plain",
    };

    const chatSession = model.startChat({
        generationConfig,
        history: [
            {
                role: "user",
                parts: [{ text: `output of the inference (stored in a variable)\n\n${inferences}` }],
            },
        ],
    });

    const result = await chatSession.sendMessageStream("Summarize the financial document based on the provided inferences.");
    return result; // Return the stream
}

// --- Express Routes for Streaming ---

app.get('/stream-swot', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const inferences = req.query.inferences; // Get inferences from query parameter
    if (!inferences) {
        return res.status(400).send('Missing inferences for SWOT analysis.');
    }

    try {
        const stream = await runSWOTAnalysisStream(inferences);
        for await (const chunk of stream) {
            const textChunk = chunk.text();
            res.write(`data: ${textChunk}\n\n`);
        }
        res.end();
    } catch (error) {
        console.error('Error streaming SWOT analysis:', error);
        res.write(`data: Error: ${error.message}\n\n`);
        res.end();
    }
});

app.get('/stream-strategy', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const inferences = req.query.inferences; // Get inferences from query parameter
    if (!inferences) {
        return res.status(400).send('Missing inferences for competitor strategy.');
    }

    try {
        const stream = await runCompetitorStrategyStream(inferences);
        for await (const chunk of stream) {
            const textChunk = chunk.text();
            res.write(`data: ${textChunk}\n\n`);
        }
        res.end();
    } catch (error) {
        console.error('Error streaming competitor strategy:', error);
        res.write(`data: Error: ${error.message}\n\n`);
        res.end();
    }
});

app.get('/stream-profile', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const inferences = req.query.inferences; // Get inferences from query parameter
    if (!inferences) {
        return res.status(400).send('Missing inferences for competitor profile.');
    }

    try {
        const stream = await runCompetitorProfileStream(inferences);
        for await (const chunk of stream) {
            const textChunk = chunk.text();
            res.write(`data: ${textChunk}\n\n`);
        }
        res.end();
    } catch (error) {
        console.error('Error streaming competitor profile:', error);
        res.write(`data: Error: ${error.message}\n\n`);
        res.end();
    }
});

app.get('/stream-key-analysis', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const swotOutput = req.query.swot;
    const strategyOutput = req.query.strategy;
    const profileOutput = req.query.profile;

    if (!swotOutput || !strategyOutput || !profileOutput) {
        return res.status(400).send('Missing outputs for key analysis.');
    }

    try {
        const stream = await runKeyAnalysisStream(swotOutput, strategyOutput, profileOutput);
        for await (const chunk of stream) {
            const textChunk = chunk.text();
            res.write(`data: ${textChunk}\n\n`);
        }
        res.end();
    } catch (error) {
        console.error('Error streaming key analysis:', error);
        res.write(`data: Error: ${error.message}\n\n`);
        res.end();
    }
});

app.get('/stream-summary', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const inferences = req.query.inferences; // Get inferences from query parameter
    if (!inferences) {
        return res.status(400).send('Missing inferences for summary.');
    }

    try {
        const stream = await runSummarizerStream(inferences);
        for await (const chunk of stream) {
            const textChunk = chunk.text();
            res.write(`data: ${textChunk}\n\n`);
        }
        res.end();
    } catch (error) {
        console.error('Error streaming summary:', error);
        res.write(`data: Error: ${error.message}\n\n`);
        res.end();
    }
});

// --- Main Analyze Route (Modified to Orchestrate with Logging) ---

app.use(express.static(path.join(__dirname, '.')));
app.use(express.json());

app.post('/analyze', upload.single('pdfFile'), async (req, res) => {
    console.log("Request received at /analyze"); // Log at the beginning of the route handler

    if (!req.file) {
        console.log("No file uploaded."); // Log if no file is uploaded
        return res.status(400).send('No PDF file uploaded.');
    }

    console.log("Uploaded file details:", req.file); // Log details about the uploaded file

    const pdfPath = req.file.path;
    console.log("Attempting to process file at path:", pdfPath); // Log the path before trying to use it

    let inferences = '';

    try {
        const inferencesStream = await runTextTableImageInference(pdfPath);
        for await (const chunk of inferencesStream) {
            inferences += chunk.text();
        }
        console.log("Inferences complete.");

        // Trigger streaming for SWOT, Strategy, and Profile
        // The frontend will handle displaying these

        // Clean up the uploaded file
        fs.unlink(pdfPath, (err) => {
            if (err) console.error('Error deleting uploaded file:', err);
        });

        res.json({ message: 'Analysis initiated. Check the side and center panels for streaming results.', inferences: inferences });

    } catch (error) {
        console.error("Error during initial analysis:", error);
        res.status(500).send(`Error during analysis: ${error.message}`);
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});