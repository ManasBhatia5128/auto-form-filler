chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "INITIATE_FORM_FILL") {
    processForm()
      .then(logs => {
        sendResponse({ status: "done", logs: logs || "Empty logs." });
      })
      .catch(err => {
        sendResponse({ status: "done", logs: "CRITICAL SCRIPT ERROR: " + err.message + "\n" + err.stack });
      });
    return true; // async response
  }
});

async function processForm() {
  let logs = [];
  const log = (msg) => { 
    console.log(msg); 
    logs.push(msg); 
  };

  log("Semantic Auto-Filler: Scanning form...");

  // Added .Qr7Oae which is widely used in newer Google Forms
  const items = document.querySelectorAll('[role="listitem"], .geS5nc, .Qr7Oae');
  log(`Found ${items.length} question containers.`);

  let filledCount = 0;

  for (const item of items) {
    const questionEl = item.querySelector('[role="heading"], .M7eMe');
    if (!questionEl) {
      continue; // Not a question block (maybe a section header)
    }
    
    let questionText = questionEl.innerText.trim();
    // Remove required asterisk and normalize
    questionText = questionText.replace(/\*$/, '').trim();
    
    if (!questionText) continue;

    log(`\nProcessing: "${questionText}"`);

    // Ask background script for semantic match
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "FIND_MATCH", questionText }, resolve);
    });

    if (response && response.match) {
      log(` -> AI Match: "${response.match}" (Score: ${response.score.toFixed(2)})`);
      const success = await fillField(item, response.match);
      if (success) {
        log(` -> SUCCESS: Filled field.`);
        filledCount++;
      } else {
        log(` -> FAIL: Could not find compatible input elements (Text/Radio/Checkbox/Dropdown) in DOM.`);
      }
    } else if (response) {
      log(` -> SKIP: No semantic match above threshold. Highest score was ${response.score ? response.score.toFixed(2) : 'N/A'}`);
    } else {
      log(` -> ERROR: No response from background script.`);
    }
  }

  log(`\n--- Finished ---`);
  log(`Successfully filled ${filledCount} fields.`);
  return logs.join('\n');
}

async function fillField(container, value) {
  let success = false;
  // Handle both string values and arrays of possible values
  const valuesToMatch = Array.isArray(value) ? value : [value];
  const primaryValue = valuesToMatch[0]; // Used for text fields

  // 1. Text Inputs & Textareas
  // Using a broader selector for text inputs
  const textInput = container.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="url"], input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea');
  
  if (textInput) {
    textInput.value = primaryValue;
    
    // Google Forms uses complex JS frameworks. Firing multiple events is key.
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    textInput.dispatchEvent(new Event('change', { bubbles: true }));
    textInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    textInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    textInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    
    // Fallback: update the data attribute Google often uses
    if (textInput.hasAttribute('data-initial-value')) {
      textInput.setAttribute('data-initial-value', primaryValue);
    }
    
    // Fallback for some Angular-based forms: explicitly update the parent label class
    const wrapper = textInput.closest('.is-empty');
    if (wrapper) wrapper.classList.remove('is-empty');
    
    return true;
  }

  // 2. Radio Buttons or Checkboxes
  const options = container.querySelectorAll('[role="radio"], [role="checkbox"]');
  if (options.length > 0) {
    for (const option of options) {
      const label = option.getAttribute('aria-label') || option.innerText || "";
      const labelLower = label.toLowerCase();
      
      let matched = false;
      for (const val of valuesToMatch) {
        const valLower = val.toString().toLowerCase();
        if (labelLower === valLower || labelLower.includes(valLower)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        option.click();
        // Ensure events bubble
        option.dispatchEvent(new Event('change', { bubbles: true }));
        success = true;
        break; // Stop at first match
      }
    }
    if (success) return true;
  }

  // 3. Dropdowns
  const dropdown = container.querySelector('[role="listbox"]');
  if (dropdown) {
    // Google Forms often requires full mouse/pointer events to open dropdowns
    dropdown.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    dropdown.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    dropdown.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
    dropdown.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    dropdown.click();
    
    // Wait for DOM to render and animate the menu
    await new Promise(r => setTimeout(r, 600));
    
    // Find visible options in the body
    let menuItems = [];
    const activePopups = document.querySelectorAll('.OA0qNb:not([style*="display: none"]), .exportSelectPopup');
    
    for (const popup of activePopups) {
      if (popup.getBoundingClientRect().height > 0) {
        const options = popup.querySelectorAll('[role="option"]');
        if (options.length > 0) {
          menuItems = Array.from(options);
          break;
        }
      }
    }

    // Fallback if popup wasn't found - search all options but filter hidden ones precisely
    if (menuItems.length === 0) {
       menuItems = Array.from(document.querySelectorAll('[role="option"]')).filter(el => el.getBoundingClientRect().height > 0);
    }
    
    for (const item of menuItems) {
      const itemText = (item.innerText || item.getAttribute('data-value') || "").trim();
      if (!itemText || itemText === "Choose") continue;

      const itemLower = itemText.toLowerCase();
      let matched = false;

      // Check against all possible values provided in the JSON
      for (const val of valuesToMatch) {
        const valLower = val.toString().toLowerCase();
        // Exact match is best, but we allow substring match
        if (itemLower === valLower || itemLower.includes(valLower)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        // Dispatch full pointer sequence for Google's JS
        item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
        item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        item.click();
        
        success = true;
        // Wait a moment for the menu to visually close before moving to the next field
        await new Promise(r => setTimeout(r, 400));
        break;
      }
    }

    if (!success) {
      // Close dropdown if no match found
      document.body.click();
      await new Promise(r => setTimeout(r, 300));
    }
    return success;
  }

  return false;
}
