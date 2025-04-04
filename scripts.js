document.addEventListener('DOMContentLoaded', () => {
    const pdfFile = document.getElementById('pdfFile');
    const analyzeButton = document.getElementById('analyzeButton');
    const loadingDiv = document.getElementById('loading');
    const swotOutput = document.getElementById('swotOutput');
    const strategyOutput = document.getElementById('strategyOutput');
    const profileOutput = document.getElementById('profileOutput');
    const keyAnalysisOutput = document.getElementById('keyAnalysisOutput');
    const summaryOutput = document.getElementById('summaryOutput');

    pdfFile.addEventListener('change', () => {
        analyzeButton.disabled = !pdfFile.files.length;
    });

    analyzeButton.addEventListener('click', async () => {
        if (!pdfFile.files.length) {
            alert('Please select a PDF file.');
            return;
        }

        const file = pdfFile.files[0];
        const formData = new FormData();
        formData.append('pdfFile', file);

        loadingDiv.style.display = 'block';
        swotOutput.textContent = '';
        strategyOutput.textContent = '';
        profileOutput.textContent = '';
        keyAnalysisOutput.textContent = '';
        summaryOutput.textContent = '';

        try {
            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const data = await response.json();
                console.log(data.message); // Should log "Analysis initiated..."

                // Get the initial inferences
                let inferences = '';
                const inferencesResponse = await fetch('/analyze', { // Re-upload to get inferences
                    method: 'POST',
                    body: formData,
                });
                if (inferencesResponse.ok) {
                    const inferencesData = await inferencesResponse.json();
                    inferences = inferencesData.inferences;
                    startStreaming(inferences);
                } else {
                    console.error("Error fetching initial inferences.");
                    loadingDiv.style.display = 'none';
                    return;
                }

            } else {
                const error = await response.text();
                console.error(`Error initiating analysis: ${error}`);
                loadingDiv.style.display = 'none';
            }
        } catch (error) {
            console.error(`Network error initiating analysis: ${error.message}`);
            loadingDiv.style.display = 'none';
        }
    });

    async function startStreaming(inferences) {
        // Stream SWOT Analysis to the left panel
        const swotSource = new EventSource(`/stream-swot?inferences=${encodeURIComponent(inferences)}`);
        swotSource.onmessage = (event) => {
            swotOutput.textContent += event.data;
        };
        swotSource.onerror = (error) => {
            console.error('SSE error (SWOT):', error);
            swotSource.close();
        };

        // Stream Competitor Strategy to the left panel
        const strategySource = new EventSource(`/stream-strategy?inferences=${encodeURIComponent(inferences)}`);
        strategySource.onmessage = (event) => {
            strategyOutput.textContent += event.data;
        };
        strategySource.onerror = (error) => {
            console.error('SSE error (Strategy):', error);
            strategySource.close();
        };

        // Stream Competitor Profile to the left panel
        const profileSource = new EventSource(`/stream-profile?inferences=${encodeURIComponent(inferences)}`);
        profileSource.onmessage = (event) => {
            profileOutput.textContent += event.data;
        };
        profileSource.onerror = (error) => {
            console.error('SSE error (Profile):', error);
            profileSource.close();
        };

        // Stream Key Analysis to the center panel
        // We need to fetch the outputs of SWOT, Strategy, and Profile first
        let swotText = '';
        let strategyText = '';
        let profileText = '';

        const fetchFullOutputs = async () => {
            // (Simplified - you might need a better way to ensure these are fully generated)
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait a bit for side panels to populate

            swotText = swotOutput.textContent;
            strategyText = strategyOutput.textContent;
            profileText = profileOutput.textContent;

            const keyAnalysisSource = new EventSource(`/stream-key-analysis?swot=${encodeURIComponent(swotText)}&strategy=${encodeURIComponent(strategyText)}&profile=${encodeURIComponent(profileText)}`);
            keyAnalysisSource.onmessage = (event) => {
                keyAnalysisOutput.textContent += event.data;
            };
            keyAnalysisSource.onerror = (error) => {
                console.error('SSE error (Key Analysis):', error);
                keyAnalysisSource.close();
            };

            // Stream Summary to the center panel
            const summarySource = new EventSource(`/stream-summary?inferences=${encodeURIComponent(inferences)}`);
            summarySource.onmessage = (event) => {
                summaryOutput.textContent += event.data;
            };
            summarySource.onerror = (error) => {
                console.error('SSE error (Summary):', error);
                summarySource.close();
            };

            loadingDiv.style.display = 'none';
        };

        fetchFullOutputs();
    }
});