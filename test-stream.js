require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using a text-only model for simplicity

async function testStreaming() {
    try {
        const result = await model.generateContentStream("Tell me a short story.");
        console.log("Is result async iterable?", typeof result?.[Symbol.asyncIterator] === 'function');
        for await (const chunk of result) {
            process.stdout.write(chunk.text());
        }
        console.log("\nStream ended.");
    } catch (error) {
        console.error("Error during streaming:", error);
    }
}

testStreaming();