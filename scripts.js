document.addEventListener('DOMContentLoaded', () => {
    const pdfFile = document.getElementById('pdfFile');
    const analyzeButton = document.getElementById('analyzeButton');
    const loadingDiv = document.getElementById('loading');
    const resultsDiv = document.getElementById('results');
    const analysisOutput = document.getElementById('analysisOutput');

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
        resultsDiv.style.display = 'none';
        analysisOutput.textContent = '';

        try {
            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const data = await response.json();
                analysisOutput.textContent = JSON.stringify(data, null, 2); // Display formatted JSON
                resultsDiv.style.display = 'block';
            } else {
                const error = await response.text();
                analysisOutput.textContent = `Error: ${error}`;
                resultsDiv.style.display = 'block';
            }
        } catch (error) {
            analysisOutput.textContent = `Network error: ${error.message}`;
            resultsDiv.style.display = 'block';
        } finally {
            loadingDiv.style.display = 'none';
        }
    });
});