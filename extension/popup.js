document.addEventListener('DOMContentLoaded', () => {
  const fillBtn = document.getElementById('fillFormBtn');
  const statusEl = document.getElementById('status');

  fillBtn.addEventListener('click', async () => {
    statusEl.innerHTML = 'Processing...';
    fillBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url.includes("docs.google.com/forms")) {
        statusEl.textContent = 'Error: Not a Google Form.';
        fillBtn.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: "INITIATE_FORM_FILL" }, (response) => {
        if (chrome.runtime.lastError) {
          statusEl.textContent = 'Error contacting content script. Try reloading the Google Forms page (F5).';
          console.error(chrome.runtime.lastError);
        } else if (response && response.status === 'done') {
          // Display the detailed execution logs
          const rawLogs = response.logs || "No logs were returned by the content script. Ensure the Google Form page was refreshed after updating the extension.";
          const logLines = rawLogs.split('\n');
          let formattedLogs = logLines.map(line => {
             if (line.includes('ERROR') || line.includes('FAIL')) {
               return `<div style="color: #dc2626; margin: 4px 0;">${line}</div>`;
             }
             if (line.includes('SUCCESS')) {
               return `<div style="color: #16a34a; margin: 4px 0;">${line}</div>`;
             }
             if (line.includes('SKIP')) {
               return `<div style="color: #ca8a04; margin: 4px 0;">${line}</div>`;
             }
             if (line.includes('Processing:')) {
               return `<div style="font-weight: bold; margin-top: 8px;">${line}</div>`;
             }
             return `<div>${line}</div>`;
          }).join('');

          statusEl.innerHTML = `<div style="text-align: left; font-size: 11px; max-height: 250px; overflow-y: auto; padding: 4px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff;">
            ${formattedLogs}
          </div>`;
          
          fillBtn.disabled = false;
        } else {
          statusEl.textContent = 'Failed to initiate.';
        }
        fillBtn.disabled = false;
      });
    } catch (error) {
      console.error(error);
      statusEl.textContent = 'An unexpected error occurred.';
      fillBtn.disabled = false;
    }
  });
});
