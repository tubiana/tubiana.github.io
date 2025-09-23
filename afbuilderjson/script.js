// Global variables
let components = [];
let constraints = [];
let templates = [];
let msaConfigurations = [];
let af3Templates = [];
let bondedAtomPairs = [];
let ptmData = {}; // Store PTM modifications by component ID and position
let currentPTMContext = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    updateOutput();
});

function initializeEventListeners() {
    // Component management
    document.getElementById('addComponent').addEventListener('click', addComponent);
    
    // Advanced options
    document.getElementById('showConstraints').addEventListener('change', toggleConstraints);
    document.getElementById('showTemplates').addEventListener('change', toggleTemplates);
    document.getElementById('enableAffinity').addEventListener('change', toggleAffinity);
    
    // Affinity ligand selection
    document.getElementById('affinityLigand').addEventListener('change', updateOutput);
    
    // Constraints and templates
    document.getElementById('addConstraint').addEventListener('click', addConstraint);
    document.getElementById('addTemplate').addEventListener('click', addTemplate);
    
    // Job name and format changes
    document.getElementById('jobName').addEventListener('input', updateOutput);
    document.getElementById('outputFormat').addEventListener('change', handleFormatChange);
    document.getElementById('modelSeeds').addEventListener('input', updateOutput);
    document.getElementById('af3Version').addEventListener('change', updateOutput);
    
    // Download functionality
    document.getElementById('downloadOutput').addEventListener('click', downloadOutput);
    
    // MSA and template functionality
    document.getElementById('addMsaConfig').addEventListener('click', addMsaConfiguration);
    document.getElementById('addAf3Template').addEventListener('click', addAf3Template);
    document.getElementById('addBondedAtomPair').addEventListener('click', addBondedAtomPair);
    
    // PTM Modal
    document.getElementById('ptmModal').addEventListener('click', function(e) {
        if (e.target.id === 'ptmModal') {
            closePTMModal();
        }
    });
    document.querySelector('.close').addEventListener('click', closePTMModal);
    document.getElementById('cancelPTM').addEventListener('click', closePTMModal);
    document.getElementById('applyPTM').addEventListener('click', applyPTM);
    document.getElementById('removePTM').addEventListener('click', removePTM);
}

function addComponent() {
    const type = document.getElementById('componentType').value;
    const componentId = generateComponentId();
    
    const component = {
        id: componentId,
        type: type,
        chainId: 'A', // Will be recalculated
        copies: 1,
        sequence: '',
        smiles: '',
        ccd: '',
        msa: '',
        modifications: []
    };
    
    components.push(component);
    recalculateChainIds();
    renderComponent(component);
    updateOutput();
}

function generateComponentId() {
    return 'comp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

function getNextChainId() {
    const usedChainIds = components.map(c => c.chainId);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    
    for (let letter of alphabet) {
        if (!usedChainIds.includes(letter)) {
            return letter;
        }
    }
    
    // If all single letters are used, start with AA, AB, etc.
    for (let i = 0; i < alphabet.length; i++) {
        for (let j = 0; j < alphabet.length; j++) {
            const chainId = alphabet[i] + alphabet[j];
            if (!usedChainIds.includes(chainId)) {
                return chainId;
            }
        }
    }
    
    return 'Z' + components.length; // Fallback
}

function renderComponent(component) {
    const container = document.getElementById('componentsList');
    const componentDiv = document.createElement('div');
    componentDiv.className = 'component-item';
    componentDiv.dataset.componentId = component.id;
    
    componentDiv.innerHTML = `
        <div class="component-header">
            <span class="component-type">${component.type}</span>
            <button class="btn btn-danger btn-small remove-component" onclick="removeComponent('${component.id}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label>Chain ID:</label>
                <input type="text" value="${component.chainId}" oninput="updateComponentProperty('${component.id}', 'chainId', this.value)">
            </div>
            <div class="form-group">
                <label>Number of Copies:</label>
                <input type="number" value="${component.copies}" min="1" oninput="updateComponentProperty('${component.id}', 'copies', parseInt(this.value))">
            </div>
        </div>
        
        ${renderComponentSpecificFields(component)}
    `;
    
    container.appendChild(componentDiv);
}

function renderComponentSpecificFields(component) {
    switch (component.type) {
        case 'protein':
        case 'dna':
        case 'rna':
            return `
                <div class="form-group">
                    <label>Sequence:</label>
                    <textarea placeholder="Enter ${component.type} sequence..." oninput="updateComponentProperty('${component.id}', 'sequence', this.value)">${component.sequence}</textarea>
                </div>
                ${component.type === 'protein' ? `
                <div class="form-group">
                    <label>MSA Path (optional):</label>
                    <input type="text" placeholder="./path/to/msa.a3m or empty" value="${component.msa}" oninput="updateComponentProperty('${component.id}', 'msa', this.value)">
                </div>
                ` : ''}
                <div id="sequence-display-${component.id}" class="sequence-display" style="display: none;">
                    <!-- Formatted sequence will appear here -->
                </div>
            `;
        case 'ligand':
        case 'sugar':
            return `
                <div class="form-row">
                    <div class="form-group">
                        <label>SMILES String:</label>
                        <input type="text" placeholder="e.g., CC1=CC=CC=C1" value="${component.smiles}" oninput="updateComponentProperty('${component.id}', 'smiles', this.value)">
                    </div>
                    <div class="form-group">
                        <label>CCD Code:</label>
                        <input type="text" placeholder="e.g., ATP, GLC" value="${component.ccd}" oninput="updateComponentProperty('${component.id}', 'ccd', this.value)">
                    </div>
                </div>
                <p class="form-help">Note: Use either SMILES or CCD code, not both.</p>
            `;
        default:
            return '';
    }
}

function updateComponentProperty(componentId, property, value) {
    const component = components.find(c => c.id === componentId);
    if (component) {
        component[property] = value;
        
        // If copies changed, recalculate all chain IDs
        if (property === 'copies') {
            recalculateChainIds();
        }
        
        // If it's a sequence change for protein, update the display
        if (property === 'sequence' && (component.type === 'protein' || component.type === 'dna' || component.type === 'rna')) {
            renderSequenceDisplay(component);
        }
        
        // Handle ligand/sugar mutual exclusivity
        if (component.type === 'ligand' || component.type === 'sugar') {
            if (property === 'smiles' && value) {
                component.ccd = '';
                const ccdInput = document.querySelector(`[data-component-id="${componentId}"] input[placeholder*="CCD"]`);
                if (ccdInput) ccdInput.value = '';
            } else if (property === 'ccd' && value) {
                component.smiles = '';
                const smilesInput = document.querySelector(`[data-component-id="${componentId}"] input[placeholder*="SMILES"]`);
                if (smilesInput) smilesInput.value = '';
            }
        }
        
        // Re-render component if chain ID changed
        if (property === 'copies') {
            reRenderAllComponents();
        }
        
        updateOutput();
    }
}

function recalculateChainIds() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let chainIndex = 0;
    
    // Store current affinity selection to try to maintain it
    const currentAffinityLigand = document.getElementById('affinityLigand').value;
    let affinityComponentIndex = -1;
    
    // Find which component was selected for affinity (by index)
    if (currentAffinityLigand) {
        affinityComponentIndex = components.findIndex(c => c.chainId === currentAffinityLigand && c.type === 'ligand');
    }
    
    components.forEach(component => {
        component.chainId = alphabet[chainIndex % alphabet.length];
        
        // If we need more chain IDs than alphabet, add numbers
        if (chainIndex >= alphabet.length) {
            component.chainId = alphabet[chainIndex % alphabet.length] + Math.floor(chainIndex / alphabet.length);
        }
        
        // Advance by the number of copies this component uses
        chainIndex += component.copies;
    });
    
    // Update affinity selection if it was previously set
    if (affinityComponentIndex >= 0 && components[affinityComponentIndex].type === 'ligand') {
        // Use setTimeout to ensure the affinity options are updated after this function completes
        setTimeout(() => {
            document.getElementById('affinityLigand').value = components[affinityComponentIndex].chainId;
        }, 0);
    }
}

function reRenderAllComponents() {
    const container = document.getElementById('componentsList');
    container.innerHTML = '';
    
    components.forEach(component => {
        renderComponent(component);
    });
    
    // Re-render format-specific sections to update dropdowns
    if (msaConfigurations.length > 0) {
        renderMsaConfigurations();
    }
    if (af3Templates.length > 0) {
        renderAf3Templates();
    }
    if (bondedAtomPairs.length > 0) {
        renderBondedAtomPairs();
    }
}

function removeComponent(componentId) {
    components = components.filter(c => c.id !== componentId);
    document.querySelector(`[data-component-id="${componentId}"]`).remove();
    delete ptmData[componentId]; // Remove PTM data for this component
    
    // Recalculate chain IDs for remaining components
    recalculateChainIds();
    reRenderAllComponents();
    
    updateOutput();
}

function renderSequenceDisplay(component) {
    const displayContainer = document.getElementById(`sequence-display-${component.id}`);
    if (!displayContainer || !component.sequence) {
        if (displayContainer) displayContainer.style.display = 'none';
        return;
    }
    
    displayContainer.style.display = 'block';
    const sequence = component.sequence.toUpperCase();
    let html = '';
    
    for (let i = 0; i < sequence.length; i += 50) {
        const lineStart = i + 1;
        const lineSequence = sequence.substring(i, i + 50);
        
        html += `<div class="sequence-line">
            <span class="sequence-number">${lineStart}</span>
            <span class="sequence-content">`;
        
        for (let j = 0; j < lineSequence.length; j++) {
            const position = i + j + 1;
            const aminoAcid = lineSequence[j];
            const isModified = ptmData[component.id] && ptmData[component.id][position];
            const isTick = (position % 10 === 0);
            
            html += `<span class="amino-acid ${isModified ? 'modified' : ''} ${isTick ? 'tick' : ''}" 
                          data-position="${position}" 
                          data-component-id="${component.id}"
                          onclick="openPTMModal('${component.id}', ${position}, '${aminoAcid}')"
                          title="Position ${position}: ${aminoAcid}${isModified ? ' (Modified)' : ''}">${aminoAcid}</span>`;
        }
        
        html += `</span></div>`;
    }
    
    displayContainer.innerHTML = html;
}

function openPTMModal(componentId, position, aminoAcid) {
    const component = components.find(c => c.id === componentId);
    if (!component || component.type !== 'protein') return;
    
    currentPTMContext = { componentId, position, aminoAcid };
    
    document.getElementById('ptmPosition').textContent = `${position} (${aminoAcid})`;
    
    const ptmOptions = getPTMOptions(aminoAcid);
    const optionsContainer = document.getElementById('ptmOptions');
    
    optionsContainer.innerHTML = '';
    ptmOptions.forEach(option => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'ptm-option';
        optionDiv.dataset.ccd = option.code;
        optionDiv.innerHTML = `
            <strong>${option.code}</strong><br>
            <small>${option.name}</small>
        `;
        optionDiv.onclick = () => selectPTMOption(optionDiv);
        optionsContainer.appendChild(optionDiv);
    });
    
    // Mark current selection if exists
    const currentPTM = ptmData[componentId] && ptmData[componentId][position];
    if (currentPTM) {
        const currentOption = optionsContainer.querySelector(`[data-ccd="${currentPTM}"]`);
        if (currentOption) {
            currentOption.classList.add('selected');
        }
    }
    
    document.getElementById('ptmModal').style.display = 'block';
}

function selectPTMOption(optionElement) {
    // Remove previous selection
    document.querySelectorAll('.ptm-option.selected').forEach(el => el.classList.remove('selected'));
    // Add selection to clicked option
    optionElement.classList.add('selected');
}

function applyPTM() {
    if (!currentPTMContext) return;
    
    const selectedOption = document.querySelector('.ptm-option.selected');
    if (!selectedOption) return;
    
    const { componentId, position } = currentPTMContext;
    const ccdCode = selectedOption.dataset.ccd;
    
    // Initialize PTM data structure if needed
    if (!ptmData[componentId]) {
        ptmData[componentId] = {};
    }
    
    ptmData[componentId][position] = ccdCode;
    
    // Update the component's modifications array
    const component = components.find(c => c.id === componentId);
    if (component) {
        // Remove existing modification at this position
        component.modifications = component.modifications.filter(mod => mod.position !== position);
        // Add new modification
        component.modifications.push({ position, ccd: ccdCode });
        
        // Re-render sequence display
        renderSequenceDisplay(component);
        updateOutput();
    }
    
    closePTMModal();
}

function removePTM() {
    if (!currentPTMContext) return;
    
    const { componentId, position } = currentPTMContext;
    
    // Remove from PTM data
    if (ptmData[componentId]) {
        delete ptmData[componentId][position];
    }
    
    // Remove from component modifications
    const component = components.find(c => c.id === componentId);
    if (component) {
        component.modifications = component.modifications.filter(mod => mod.position !== position);
        renderSequenceDisplay(component);
        updateYAML();
    }
    
    closePTMModal();
}

function closePTMModal() {
    document.getElementById('ptmModal').style.display = 'none';
    currentPTMContext = null;
}

function toggleConstraints() {
    const show = document.getElementById('showConstraints').checked;
    document.querySelector('.constraints-section').style.display = show ? 'block' : 'none';
}

function toggleTemplates() {
    const show = document.getElementById('showTemplates').checked;
    document.querySelector('.templates-section').style.display = show ? 'block' : 'none';
}

function toggleAffinity() {
    const show = document.getElementById('enableAffinity').checked;
    document.getElementById('affinityOptions').style.display = show ? 'block' : 'none';
    if (show) {
        updateAffinityOptions();
    }
    updateOutput();
}

function updateAffinityOptions() {
    const affinitySelect = document.getElementById('affinityLigand');
    const currentSelection = affinitySelect.value;
    const ligandComponents = components.filter(c => c.type === 'ligand');
    
    // Clear existing options except the first one
    affinitySelect.innerHTML = '<option value="">Select a ligand...</option>';
    
    ligandComponents.forEach(component => {
        const option = document.createElement('option');
        option.value = component.chainId;
        option.textContent = `${component.chainId} (${component.ccd || component.smiles || 'Ligand'})`;
        
        // Restore selection if the same ligand still exists
        if (component.chainId === currentSelection) {
            option.selected = true;
        }
        
        affinitySelect.appendChild(option);
    });
    
    // If no ligands available, clear selection
    if (ligandComponents.length === 0) {
        affinitySelect.value = '';
    }
}

function updateYAML() {
    const yaml = generateYAML();
    document.getElementById('outputContent').value = yaml;
    
    // Update affinity options if affinity is enabled
    if (document.getElementById('enableAffinity').checked) {
        updateAffinityOptions();
    }
    
    // Run validation
    const errors = validateConfiguration();
    if (errors.length > 0) {
        showValidationErrors(errors);
    } else {
        clearValidationErrors();
    }
}

function updateOutput() {
    const format = document.getElementById('outputFormat').value;
    
    if (format === 'boltz') {
        const yaml = generateYAML();
        document.getElementById('outputContent').value = yaml;
    } else if (format === 'alphafold3') {
        const json = generateAlphaFold3JSON();
        document.getElementById('outputContent').value = json;
    }
    
    // Update affinity options if affinity is enabled and format is boltz
    if (format === 'boltz' && document.getElementById('enableAffinity').checked) {
        updateAffinityOptions();
    }
    
    // Run validation
    const errors = validateConfiguration();
    if (errors.length > 0) {
        showValidationErrors(errors);
    } else {
        clearValidationErrors();
    }
}

function handleFormatChange() {
    const format = document.getElementById('outputFormat').value;
    const af3Config = document.getElementById('alphafold3Config');
    const affinitySection = document.querySelector('.advanced-options');
    
    // Get format-specific sections
    const af3MsaSection = document.getElementById('af3MsaSection');
    const af3TemplatesSection = document.getElementById('af3TemplatesSection');
    const bondedAtomPairsSection = document.getElementById('bondedAtomPairsSection');
    const constraintsSection = document.querySelector('.constraints-section');
    const templatesSection = document.querySelector('.templates-section');
    
    // Show/hide sections based on format
    if (format === 'alphafold3') {
        af3Config.style.display = 'block';
        af3MsaSection.style.display = 'block';
        af3TemplatesSection.style.display = 'block';
        bondedAtomPairsSection.style.display = 'block';
        constraintsSection.style.display = 'none';
        templatesSection.style.display = 'none';
        
        // Hide affinity for AlphaFold3 (not supported in this interface for AF3)
        document.getElementById('enableAffinity').checked = false;
        toggleAffinity();
    } else {
        af3Config.style.display = 'none';
        af3MsaSection.style.display = 'none';
        af3TemplatesSection.style.display = 'none';
        bondedAtomPairsSection.style.display = 'none';
        constraintsSection.style.display = 'block';
        templatesSection.style.display = 'block';
    }
    
    // Update labels
    document.getElementById('outputFormatLabel').textContent = format === 'boltz' ? 'YAML' : 'JSON';
    document.getElementById('downloadFormatLabel').textContent = format === 'boltz' ? 'YAML' : 'JSON';
    
    updateOutput();
}

function generateYAML() {
    let yaml = 'version: 1\n';
    
    // Sequences section
    if (components.length > 0) {
        yaml += 'sequences:\n';
        
        components.forEach(component => {
            yaml += `  - ${component.type}:\n`;
            
            // Handle multiple copies
            if (component.copies > 1) {
                const chainIds = [];
                const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                
                // Find the starting index for this component
                let startIndex = 0;
                for (let i = 0; i < components.indexOf(component); i++) {
                    startIndex += components[i].copies;
                }
                
                for (let i = 0; i < component.copies; i++) {
                    const chainIndex = startIndex + i;
                    if (chainIndex < alphabet.length) {
                        chainIds.push(alphabet[chainIndex]);
                    } else {
                        chainIds.push(alphabet[chainIndex % alphabet.length] + Math.floor(chainIndex / alphabet.length));
                    }
                }
                yaml += `      id: [${chainIds.join(', ')}]\n`;
            } else {
                yaml += `      id: ${component.chainId}\n`;
            }
            
            // Add type-specific properties
            if (['protein', 'dna', 'rna'].includes(component.type)) {
                if (component.sequence) {
                    yaml += `      sequence: ${component.sequence}\n`;
                }
                if (component.type === 'protein' && component.msa) {
                    yaml += `      msa: ${component.msa}\n`;
                }
                
                // Add modifications if any
                if (component.modifications && component.modifications.length > 0) {
                    yaml += `      modifications:\n`;
                    component.modifications.forEach(mod => {
                        yaml += `        - position: ${mod.position}\n`;
                        yaml += `          ccd: ${mod.ccd}\n`;
                    });
                }
            } else if (component.type === 'ligand' || component.type === 'sugar') {
                if (component.smiles) {
                    yaml += `      smiles: '${component.smiles}'\n`;
                } else if (component.ccd) {
                    yaml += `      ccd: ${component.ccd}\n`;
                }
            }
        });
    }
    
    // Constraints section
    if (document.getElementById('showConstraints').checked && constraints.length > 0) {
        yaml += 'constraints:\n';
        
        constraints.forEach(constraint => {
            const data = constraint.data;
            
            switch (constraint.type) {
                case 'bond':
                    if (data.atom1_chain && data.atom1_res && data.atom1_name && 
                        data.atom2_chain && data.atom2_res && data.atom2_name) {
                        yaml += `  - bond:\n`;
                        yaml += `      atom1: [${data.atom1_chain}, ${data.atom1_res}, ${data.atom1_name}]\n`;
                        yaml += `      atom2: [${data.atom2_chain}, ${data.atom2_res}, ${data.atom2_name}]\n`;
                    }
                    break;
                    
                case 'pocket':
                    if (data.binder && data.contacts) {
                        yaml += `  - pocket:\n`;
                        yaml += `      binder: ${data.binder}\n`;
                        
                        const contacts = data.contacts.split('\n')
                            .map(line => line.trim())
                            .filter(line => line && line.includes(':'))
                            .map(line => {
                                const [chain, res] = line.split(':');
                                return `[${chain.trim()}, ${res.trim()}]`;
                            });
                            
                        if (contacts.length > 0) {
                            yaml += `      contacts: [${contacts.join(', ')}]\n`;
                        }
                        
                        if (data.max_distance) {
                            yaml += `      max_distance: ${data.max_distance}\n`;
                        }
                        if (data.force) {
                            yaml += `      force: true\n`;
                        }
                    }
                    break;
                    
                case 'contact':
                    if (data.token1_chain && data.token1_res && data.token2_chain && data.token2_res) {
                        yaml += `  - contact:\n`;
                        yaml += `      token1: [${data.token1_chain}, ${data.token1_res}]\n`;
                        yaml += `      token2: [${data.token2_chain}, ${data.token2_res}]\n`;
                        
                        if (data.max_distance) {
                            yaml += `      max_distance: ${data.max_distance}\n`;
                        }
                        if (data.force) {
                            yaml += `      force: true\n`;
                        }
                    }
                    break;
            }
        });
    }
    
    // Templates section
    if (document.getElementById('showTemplates').checked && templates.length > 0) {
        yaml += 'templates:\n';
        
        templates.forEach(template => {
            const data = template.data;
            
            if (data.path) {
                yaml += `  - ${data.type || 'cif'}: ${data.path}\n`;
                
                if (data.chain_ids && data.chain_ids.length > 0) {
                    if (data.chain_ids.length === 1) {
                        yaml += `    chain_id: ${data.chain_ids[0]}\n`;
                    } else {
                        yaml += `    chain_id: [${data.chain_ids.join(', ')}]\n`;
                    }
                }
                
                if (data.template_ids) {
                    const templateIds = data.template_ids.split(',').map(id => id.trim()).filter(id => id);
                    if (templateIds.length === 1) {
                        yaml += `    template_id: ${templateIds[0]}\n`;
                    } else if (templateIds.length > 1) {
                        yaml += `    template_id: [${templateIds.join(', ')}]\n`;
                    }
                }
                
                if (data.force) {
                    yaml += `    force: true\n`;
                    if (data.threshold) {
                        yaml += `    threshold: ${data.threshold}\n`;
                    }
                }
            }
        });
    }
    
    // Properties section (affinity)
    if (document.getElementById('enableAffinity').checked) {
        const selectedLigand = document.getElementById('affinityLigand').value;
        if (selectedLigand) {
            yaml += 'properties:\n';
            yaml += `  - affinity:\n`;
            yaml += `      binder: ${selectedLigand}\n`;
        }
    }
    
    return yaml;
}

function generateAlphaFold3JSON() {
    const jobName = document.getElementById('jobName').value || 'prediction';
    const modelSeeds = document.getElementById('modelSeeds').value
        .split(',')
        .map(s => parseInt(s.trim()))
        .filter(n => !isNaN(n));
    const version = parseInt(document.getElementById('af3Version').value);
    
    const json = {
        name: jobName,
        modelSeeds: modelSeeds.length > 0 ? modelSeeds : [1],
        sequences: [],
        dialect: "alphafold3",
        version: version
    };
    
    // Convert components to AlphaFold3 format
    components.forEach(component => {
        let sequence;
        
        switch (component.type) {
            case 'protein':
                sequence = {
                    protein: {
                        id: component.copies > 1 ? getAF3ChainIds(component) : component.chainId,
                        sequence: component.sequence
                    }
                };
                
                // Add modifications in AlphaFold3 format
                if (component.modifications && component.modifications.length > 0) {
                    sequence.protein.modifications = component.modifications.map(mod => ({
                        ptmType: mod.ccd,
                        ptmPosition: mod.position
                    }));
                }
                
                // Add MSA configurations for this chain
                const msaConfig = msaConfigurations.find(msa => msa.chainId === component.chainId);
                if (msaConfig) {
                    if (msaConfig.unpairedMsa && msaConfig.unpairedMsa.trim() !== '') {
                        sequence.protein.unpairedMsa = msaConfig.unpairedMsa;
                    }
                    if (msaConfig.pairedMsa && msaConfig.pairedMsa.trim() !== '') {
                        sequence.protein.pairedMsa = msaConfig.pairedMsa;
                    }
                }
                
                // Add templates for this chain
                const chainTemplates = af3Templates.filter(template => template.chainId === component.chainId);
                if (chainTemplates.length > 0) {
                    sequence.protein.templates = chainTemplates.map(template => {
                        const templateData = { mmcif: template.mmcif };
                        
                        if (template.queryIndices && template.queryIndices.trim() !== '') {
                            templateData.queryIndices = template.queryIndices.split(',').map(i => parseInt(i.trim())).filter(n => !isNaN(n));
                        }
                        if (template.templateIndices && template.templateIndices.trim() !== '') {
                            templateData.templateIndices = template.templateIndices.split(',').map(i => parseInt(i.trim())).filter(n => !isNaN(n));
                        }
                        
                        return templateData;
                    });
                }
                break;
                
            case 'dna':
                sequence = {
                    dna: {
                        id: component.copies > 1 ? getAF3ChainIds(component) : component.chainId,
                        sequence: component.sequence
                    }
                };
                
                // Add modifications if any
                if (component.modifications && component.modifications.length > 0) {
                    sequence.dna.modifications = component.modifications.map(mod => ({
                        modificationType: mod.ccd,
                        basePosition: mod.position
                    }));
                }
                break;
                
            case 'rna':
                sequence = {
                    rna: {
                        id: component.copies > 1 ? getAF3ChainIds(component) : component.chainId,
                        sequence: component.sequence
                    }
                };
                
                // Add modifications if any
                if (component.modifications && component.modifications.length > 0) {
                    sequence.rna.modifications = component.modifications.map(mod => ({
                        modificationType: mod.ccd,
                        basePosition: mod.position
                    }));
                }
                
                // Add MSA configurations for RNA
                const rnaMsaConfig = msaConfigurations.find(msa => msa.chainId === component.chainId);
                if (rnaMsaConfig && rnaMsaConfig.unpairedMsa && rnaMsaConfig.unpairedMsa.trim() !== '') {
                    sequence.rna.unpairedMsa = rnaMsaConfig.unpairedMsa;
                }
                break;
                
            case 'ligand':
            case 'sugar':
                sequence = {
                    ligand: {
                        id: component.copies > 1 ? getAF3ChainIds(component) : component.chainId
                    }
                };
                
                if (component.smiles) {
                    sequence.ligand.smiles = component.smiles;
                } else if (component.ccd) {
                    sequence.ligand.ccdCodes = [component.ccd];
                }
                break;
        }
        
        if (sequence) {
            json.sequences.push(sequence);
        }
    });
    
    // Add bonded atom pairs
    if (bondedAtomPairs.length > 0) {
        json.bondedAtomPairs = bondedAtomPairs.map(pair => [
            [pair.atom1.chainId, pair.atom1.residueId, pair.atom1.atomName],
            [pair.atom2.chainId, pair.atom2.residueId, pair.atom2.atomName]
        ]);
    }
    
    return JSON.stringify(json, null, 2);
}

function getAF3ChainIds(component) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const chainIds = [];
    
    // Find the starting index for this component
    let startIndex = 0;
    for (let i = 0; i < components.indexOf(component); i++) {
        startIndex += components[i].copies;
    }
    
    for (let i = 0; i < component.copies; i++) {
        const chainIndex = startIndex + i;
        if (chainIndex < alphabet.length) {
            chainIds.push(alphabet[chainIndex]);
        } else {
            chainIds.push(alphabet[chainIndex % alphabet.length] + Math.floor(chainIndex / alphabet.length));
        }
    }
    
    return chainIds;
}

function downloadYAML() {
    const yaml = document.getElementById('outputContent').value;
    const jobName = document.getElementById('jobName').value || 'prediction';
    
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${jobName}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    window.URL.revokeObjectURL(url);
}

function downloadOutput() {
    const content = document.getElementById('outputContent').value;
    const jobName = document.getElementById('jobName').value || 'prediction';
    const format = document.getElementById('outputFormat').value;
    
    const extension = format === 'boltz' ? 'yaml' : 'json';
    const mimeType = format === 'boltz' ? 'text/yaml' : 'application/json';
    
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${jobName}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    window.URL.revokeObjectURL(url);
}

// Constraint management functions
function addConstraint() {
    const constraintId = 'constraint_' + Date.now();
    const constraint = {
        id: constraintId,
        type: 'bond', // default type
        data: {}
    };
    
    constraints.push(constraint);
    renderConstraint(constraint);
    updateOutput();
}

function renderConstraint(constraint) {
    const container = document.getElementById('constraintsList');
    const constraintDiv = document.createElement('div');
    constraintDiv.className = 'component-item';
    constraintDiv.dataset.constraintId = constraint.id;
    
    constraintDiv.innerHTML = `
        <div class="component-header">
            <span class="component-type">Constraint</span>
            <button class="btn btn-danger btn-small" onclick="removeConstraint('${constraint.id}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        
        <div class="form-group">
            <label>Constraint Type:</label>
            <select onchange="updateConstraintType('${constraint.id}', this.value)">
                <option value="bond" ${constraint.type === 'bond' ? 'selected' : ''}>Bond</option>
                <option value="pocket" ${constraint.type === 'pocket' ? 'selected' : ''}>Pocket</option>
                <option value="contact" ${constraint.type === 'contact' ? 'selected' : ''}>Contact</option>
            </select>
        </div>
        
        <div id="constraint-fields-${constraint.id}">
            ${renderConstraintFields(constraint)}
        </div>
    `;
    
    container.appendChild(constraintDiv);
}

function renderConstraintFields(constraint) {
    const chainOptions = components.map(c => `<option value="${c.chainId}">${c.chainId} (${c.type})</option>`).join('');
    
    switch (constraint.type) {
        case 'bond':
            return `
                <div class="form-row">
                    <div class="form-group">
                        <label>Atom 1 - Chain:</label>
                        <select onchange="updateConstraintData('${constraint.id}', 'atom1_chain', this.value)">
                            <option value="">Select chain</option>
                            ${chainOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Atom 1 - Residue Index:</label>
                        <input type="number" min="1" placeholder="1" onchange="updateConstraintData('${constraint.id}', 'atom1_res', this.value)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Atom 1 - Atom Name:</label>
                        <input type="text" placeholder="CA" onchange="updateConstraintData('${constraint.id}', 'atom1_name', this.value)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Atom 2 - Chain:</label>
                        <select onchange="updateConstraintData('${constraint.id}', 'atom2_chain', this.value)">
                            <option value="">Select chain</option>
                            ${chainOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Atom 2 - Residue Index:</label>
                        <input type="number" min="1" placeholder="1" onchange="updateConstraintData('${constraint.id}', 'atom2_res', this.value)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Atom 2 - Atom Name:</label>
                        <input type="text" placeholder="CB" onchange="updateConstraintData('${constraint.id}', 'atom2_name', this.value)">
                    </div>
                </div>
            `;
        case 'pocket':
            return `
                <div class="form-row">
                    <div class="form-group">
                        <label>Binder Chain:</label>
                        <select onchange="updateConstraintData('${constraint.id}', 'binder', this.value)">
                            <option value="">Select chain</option>
                            ${chainOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Max Distance (Å):</label>
                        <input type="number" min="4" max="20" value="6" onchange="updateConstraintData('${constraint.id}', 'max_distance', this.value)">
                    </div>
                </div>
                <div class="form-group">
                    <label>Contacts (chain:residue, one per line):</label>
                    <textarea placeholder="A:10&#10;A:15&#10;B:25" onchange="updateConstraintData('${constraint.id}', 'contacts', this.value)"></textarea>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" onchange="updateConstraintData('${constraint.id}', 'force', this.checked)"> 
                        Force constraint with potential
                    </label>
                </div>
            `;
        case 'contact':
            return `
                <div class="form-row">
                    <div class="form-group">
                        <label>Token 1 - Chain:</label>
                        <select onchange="updateConstraintData('${constraint.id}', 'token1_chain', this.value)">
                            <option value="">Select chain</option>
                            ${chainOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Token 1 - Residue/Atom:</label>
                        <input type="text" placeholder="10 or ATOM_NAME" onchange="updateConstraintData('${constraint.id}', 'token1_res', this.value)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Token 2 - Chain:</label>
                        <select onchange="updateConstraintData('${constraint.id}', 'token2_chain', this.value)">
                            <option value="">Select chain</option>
                            ${chainOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Token 2 - Residue/Atom:</label>
                        <input type="text" placeholder="15 or ATOM_NAME" onchange="updateConstraintData('${constraint.id}', 'token2_res', this.value)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Max Distance (Å):</label>
                        <input type="number" min="4" max="20" value="6" onchange="updateConstraintData('${constraint.id}', 'max_distance', this.value)">
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" onchange="updateConstraintData('${constraint.id}', 'force', this.checked)"> 
                            Force constraint
                        </label>
                    </div>
                </div>
            `;
        default:
            return '';
    }
}

function updateConstraintType(constraintId, type) {
    const constraint = constraints.find(c => c.id === constraintId);
    if (constraint) {
        constraint.type = type;
        constraint.data = {}; // Reset data when type changes
        document.getElementById(`constraint-fields-${constraintId}`).innerHTML = renderConstraintFields(constraint);
        updateOutput();
    }
}

function updateConstraintData(constraintId, key, value) {
    const constraint = constraints.find(c => c.id === constraintId);
    if (constraint) {
        constraint.data[key] = value;
        updateOutput();
    }
}

function removeConstraint(constraintId) {
    constraints = constraints.filter(c => c.id !== constraintId);
    document.querySelector(`[data-constraint-id="${constraintId}"]`).remove();
    updateOutput();
}

// Template management functions
function addTemplate() {
    const templateId = 'template_' + Date.now();
    const template = {
        id: templateId,
        type: 'cif', // default type
        data: {}
    };
    
    templates.push(template);
    renderTemplate(template);
    updateOutput();
}

function renderTemplate(template) {
    const container = document.getElementById('templatesList');
    const templateDiv = document.createElement('div');
    templateDiv.className = 'component-item';
    templateDiv.dataset.templateId = template.id;
    
    const chainOptions = components.map(c => `<option value="${c.chainId}">${c.chainId} (${c.type})</option>`).join('');
    
    templateDiv.innerHTML = `
        <div class="component-header">
            <span class="component-type">Template</span>
            <button class="btn btn-danger btn-small" onclick="removeTemplate('${template.id}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label>Template Type:</label>
                <select onchange="updateTemplateData('${template.id}', 'type', this.value)">
                    <option value="cif" ${template.type === 'cif' ? 'selected' : ''}>CIF</option>
                    <option value="pdb" ${template.type === 'pdb' ? 'selected' : ''}>PDB</option>
                </select>
            </div>
            <div class="form-group">
                <label>File Path:</label>
                <input type="text" placeholder="./path/to/template.cif" onchange="updateTemplateData('${template.id}', 'path', this.value)">
            </div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label>Chain IDs (optional):</label>
                <select multiple onchange="updateTemplateChainIds('${template.id}', this)">
                    ${chainOptions}
                </select>
                <small>Hold Ctrl/Cmd to select multiple chains</small>
            </div>
            <div class="form-group">
                <label>Template Chain IDs (optional):</label>
                <input type="text" placeholder="A1,B1" onchange="updateTemplateData('${template.id}', 'template_ids', this.value)">
                <small>Comma-separated template chain IDs</small>
            </div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label>
                    <input type="checkbox" onchange="updateTemplateData('${template.id}', 'force', this.checked)">
                    Force template constraint
                </label>
            </div>
            <div class="form-group">
                <label>Threshold (Å, if forced):</label>
                <input type="number" min="0" step="0.1" placeholder="2.0" onchange="updateTemplateData('${template.id}', 'threshold', this.value)">
            </div>
        </div>
    `;
    
    container.appendChild(templateDiv);
}

function updateTemplateData(templateId, key, value) {
    const template = templates.find(t => t.id === templateId);
    if (template) {
        template.data[key] = value;
        updateOutput();
    }
}

function updateTemplateChainIds(templateId, selectElement) {
    const selectedValues = Array.from(selectElement.selectedOptions).map(option => option.value);
    updateTemplateData(templateId, 'chain_ids', selectedValues);
}

function removeTemplate(templateId) {
    templates = templates.filter(t => t.id !== templateId);
    document.querySelector(`[data-template-id="${templateId}"]`).remove();
    updateOutput();
}

// Validation functions
function validateComponent(component, format = 'boltz') {
    const errors = [];
    
    if (!component.chainId) {
        errors.push('Chain ID is required');
    }
    
    if (['protein', 'dna', 'rna'].includes(component.type)) {
        if (!component.sequence) {
            errors.push('Sequence is required for ' + component.type);
        } else {
            // Validate sequence characters
            const validChars = getValidSequenceChars(component.type);
            const invalidChars = component.sequence.split('').filter(char => 
                !validChars.includes(char.toUpperCase())
            );
            
            if (invalidChars.length > 0) {
                errors.push(`Invalid characters in ${component.type} sequence: ${[...new Set(invalidChars)].join(', ')}`);
            }
        }
    } else if (component.type === 'ligand' || component.type === 'sugar') {
        if (!component.smiles && !component.ccd) {
            errors.push(`Either SMILES string or CCD code is required for ${component.type}`);
        }
        if (component.smiles && component.ccd) {
            errors.push('Provide either SMILES or CCD code, not both');
        }
        
        // AlphaFold3 specific validation
        if (format === 'alphafold3' && component.type === 'sugar') {
            errors.push('Use "ligand" type instead of "sugar" for AlphaFold3 format');
        }
    }
    
    return errors;
}

function getValidSequenceChars(type) {
    switch (type) {
        case 'protein':
            return 'ACDEFGHIKLMNPQRSTVWY'.split('');
        case 'dna':
            return 'ACGT'.split('');
        case 'rna':
            return 'ACGU'.split('');
        default:
            return [];
    }
}

function validateConstraint(constraint) {
    const errors = [];
    const data = constraint.data;
    
    switch (constraint.type) {
        case 'bond':
            if (!data.atom1_chain || !data.atom1_res || !data.atom1_name) {
                errors.push('Atom 1 requires chain, residue index, and atom name');
            }
            if (!data.atom2_chain || !data.atom2_res || !data.atom2_name) {
                errors.push('Atom 2 requires chain, residue index, and atom name');
            }
            break;
            
        case 'pocket':
            if (!data.binder) {
                errors.push('Binder chain is required for pocket constraint');
            }
            if (!data.contacts || !data.contacts.trim()) {
                errors.push('At least one contact is required for pocket constraint');
            }
            if (data.max_distance && (data.max_distance < 4 || data.max_distance > 20)) {
                errors.push('Max distance must be between 4 and 20 Angstroms');
            }
            break;
            
        case 'contact':
            if (!data.token1_chain || !data.token1_res) {
                errors.push('Token 1 requires chain and residue/atom identifier');
            }
            if (!data.token2_chain || !data.token2_res) {
                errors.push('Token 2 requires chain and residue/atom identifier');
            }
            if (data.max_distance && (data.max_distance < 4 || data.max_distance > 20)) {
                errors.push('Max distance must be between 4 and 20 Angstroms');
            }
            break;
    }
    
    return errors;
}

function validateTemplate(template) {
    const errors = [];
    const data = template.data;
    
    if (!data.path) {
        errors.push('Template file path is required');
    }
    
    if (data.force && !data.threshold) {
        errors.push('Threshold is required when forcing template constraint');
    }
    
    return errors;
}

function validateConfiguration() {
    const allErrors = [];
    const format = document.getElementById('outputFormat').value;
    
    // Validate components
    components.forEach((component, index) => {
        const componentErrors = validateComponent(component, format);
        componentErrors.forEach(error => {
            allErrors.push(`Component ${index + 1} (${component.type}): ${error}`);
        });
    });
    
    // Check for duplicate chain IDs
    const chainIds = components.map(c => c.chainId);
    const duplicateChainIds = chainIds.filter((id, index) => chainIds.indexOf(id) !== index);
    if (duplicateChainIds.length > 0) {
        allErrors.push(`Duplicate chain IDs: ${[...new Set(duplicateChainIds)].join(', ')}`);
    }
    
    // Format-specific validation
    if (format === 'alphafold3') {
        // Validate AlphaFold3 specific requirements
        const af3Errors = validateAlphaFold3Specific();
        allErrors.push(...af3Errors);
    } else if (format === 'boltz') {
        // Validate constraints (only for Boltz)
        constraints.forEach((constraint, index) => {
            const constraintErrors = validateConstraint(constraint);
            constraintErrors.forEach(error => {
                allErrors.push(`Constraint ${index + 1}: ${error}`);
            });
        });
        
        // Validate templates (only for Boltz)
        templates.forEach((template, index) => {
            const templateErrors = validateTemplate(template);
            templateErrors.forEach(error => {
                allErrors.push(`Template ${index + 1}: ${error}`);
            });
        });
        
        // Validate affinity settings (only for Boltz)
        if (document.getElementById('enableAffinity').checked) {
            const selectedLigand = document.getElementById('affinityLigand').value;
            const ligandComponents = components.filter(c => c.type === 'ligand');
            
            if (ligandComponents.length === 0) {
                allErrors.push('Affinity calculation requires at least one ligand component');
            } else if (!selectedLigand || selectedLigand === '') {
                allErrors.push('Please select a ligand for affinity calculation');
            } else {
                const selectedComponent = components.find(c => c.chainId === selectedLigand && c.type === 'ligand');
                if (!selectedComponent) {
                    allErrors.push('Selected ligand for affinity calculation no longer exists');
                }
            }
        }
    }
    
    return allErrors;
}

function validateAlphaFold3Specific() {
    const errors = [];
    
    // Validate model seeds
    const modelSeedsStr = document.getElementById('modelSeeds').value;
    const modelSeeds = modelSeedsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    
    if (modelSeeds.length === 0) {
        errors.push('At least one model seed is required for AlphaFold3');
    }
    
    // Check for unsupported component types
    const sugarComponents = components.filter(c => c.type === 'sugar');
    if (sugarComponents.length > 0) {
        errors.push('Sugar components should be specified as ligands in AlphaFold3 format');
    }
    
    // Validate MSA configurations
    msaConfigurations.forEach((msa, index) => {
        if (!msa.chainId) {
            errors.push(`MSA configuration ${index + 1}: Chain ID is required`);
        } else {
            const component = components.find(c => c.chainId === msa.chainId);
            if (!component) {
                errors.push(`MSA configuration ${index + 1}: Chain ID "${msa.chainId}" does not exist`);
            } else if (!['protein', 'rna'].includes(component.type)) {
                errors.push(`MSA configuration ${index + 1}: MSA can only be specified for protein or RNA chains`);
            }
        }
    });
    
    // Validate AlphaFold3 templates
    af3Templates.forEach((template, index) => {
        if (!template.chainId) {
            errors.push(`Template ${index + 1}: Chain ID is required`);
        } else {
            const component = components.find(c => c.chainId === template.chainId);
            if (!component) {
                errors.push(`Template ${index + 1}: Chain ID "${template.chainId}" does not exist`);
            } else if (component.type !== 'protein') {
                errors.push(`Template ${index + 1}: Templates can only be specified for protein chains`);
            }
        }
        
        if (!template.mmcif || template.mmcif.trim() === '') {
            errors.push(`Template ${index + 1}: mmCIF content is required`);
        }
        
        // Validate indices if provided
        if (template.queryIndices && template.queryIndices.trim() !== '') {
            const queryIndices = template.queryIndices.split(',').map(i => parseInt(i.trim())).filter(n => !isNaN(n));
            if (queryIndices.length === 0) {
                errors.push(`Template ${index + 1}: Query indices must be valid integers`);
            }
        }
        
        if (template.templateIndices && template.templateIndices.trim() !== '') {
            const templateIndices = template.templateIndices.split(',').map(i => parseInt(i.trim())).filter(n => !isNaN(n));
            if (templateIndices.length === 0) {
                errors.push(`Template ${index + 1}: Template indices must be valid integers`);
            }
        }
    });
    
    // Validate bonded atom pairs
    bondedAtomPairs.forEach((pair, index) => {
        if (!pair.atom1.chainId || !pair.atom2.chainId) {
            errors.push(`Bonded atom pair ${index + 1}: Both chain IDs are required`);
        }
        
        if (!pair.atom1.atomName || !pair.atom2.atomName) {
            errors.push(`Bonded atom pair ${index + 1}: Both atom names are required`);
        }
        
        if (pair.atom1.residueId < 1 || pair.atom2.residueId < 1) {
            errors.push(`Bonded atom pair ${index + 1}: Residue IDs must be positive integers`);
        }
        
        // Check if chains exist
        const chain1 = components.find(c => c.chainId === pair.atom1.chainId);
        const chain2 = components.find(c => c.chainId === pair.atom2.chainId);
        
        if (!chain1) {
            errors.push(`Bonded atom pair ${index + 1}: Chain "${pair.atom1.chainId}" does not exist`);
        }
        if (!chain2) {
            errors.push(`Bonded atom pair ${index + 1}: Chain "${pair.atom2.chainId}" does not exist`);
        }
    });
    
    return errors;
}

function showValidationErrors(errors) {
    // Remove existing error display
    const existingErrorDiv = document.querySelector('.validation-errors');
    if (existingErrorDiv) {
        existingErrorDiv.remove();
    }
    
    if (errors.length === 0) return;
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'validation-errors';
    errorDiv.innerHTML = `
        <div class="error-header">
            <i class="fas fa-exclamation-triangle"></i>
            Configuration Issues (${errors.length})
        </div>
        <ul>
            ${errors.map(error => `<li>${error}</li>`).join('')}
        </ul>
    `;
    
    // Insert after the output header
    const outputHeader = document.querySelector('.output-header');
    outputHeader.parentNode.insertBefore(errorDiv, outputHeader.nextSibling);
}

function clearValidationErrors() {
    const existingErrorDiv = document.querySelector('.validation-errors');
    if (existingErrorDiv) {
        existingErrorDiv.remove();
    }
}

// MSA Configuration Management
function addMsaConfiguration() {
    const msaId = 'msa_' + Date.now();
    const msa = {
        id: msaId,
        chainId: '',
        unpairedMsa: '',
        pairedMsa: '',
        msaType: 'unpaired'
    };
    
    msaConfigurations.push(msa);
    renderMsaConfigurations();
    updateOutput();
}

function renderMsaConfigurations() {
    const container = document.getElementById('msaList');
    container.innerHTML = '';
    
    msaConfigurations.forEach((msa, index) => {
        const msaDiv = document.createElement('div');
        msaDiv.className = 'msa-item';
        msaDiv.innerHTML = `
            <h4>MSA Configuration ${index + 1}</h4>
            <div class="msa-fields">
                <div class="form-group">
                    <label>Chain ID:</label>
                    <select onchange="updateMsaConfiguration('${msa.id}', 'chainId', this.value)">
                        <option value="">Select Chain...</option>
                        ${components.filter(comp => ['protein', 'rna'].includes(comp.type)).map(comp => `<option value="${comp.chainId}" ${comp.chainId === msa.chainId ? 'selected' : ''}>${comp.chainId} (${comp.type})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Type:</label>
                    <select onchange="updateMsaConfiguration('${msa.id}', 'msaType', this.value)">
                        <option value="unpaired" ${msa.msaType === 'unpaired' ? 'selected' : ''}>Unpaired MSA</option>
                        <option value="paired" ${msa.msaType === 'paired' ? 'selected' : ''}>Paired MSA</option>
                        <option value="both" ${msa.msaType === 'both' ? 'selected' : ''}>Both</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Unpaired MSA (A3M format):</label>
                    <textarea placeholder="Enter unpaired MSA in A3M format..." 
                              onchange="updateMsaConfiguration('${msa.id}', 'unpairedMsa', this.value)">${msa.unpairedMsa}</textarea>
                </div>
                <div class="form-group">
                    <label>Paired MSA (A3M format):</label>
                    <textarea placeholder="Enter paired MSA in A3M format..." 
                              onchange="updateMsaConfiguration('${msa.id}', 'pairedMsa', this.value)">${msa.pairedMsa}</textarea>
                </div>
            </div>
            <button onclick="removeMsaConfiguration('${msa.id}')" class="btn btn-danger btn-sm" style="position: absolute; top: 15px; right: 15px;">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(msaDiv);
    });
}

function updateMsaConfiguration(msaId, field, value) {
    const msa = msaConfigurations.find(m => m.id === msaId);
    if (msa) {
        msa[field] = value;
        updateOutput();
    }
}

function removeMsaConfiguration(msaId) {
    msaConfigurations = msaConfigurations.filter(m => m.id !== msaId);
    renderMsaConfigurations();
    updateOutput();
}

// AlphaFold3 Template Management
function addAf3Template() {
    const templateId = 'af3_template_' + Date.now();
    const template = {
        id: templateId,
        chainId: '',
        mmcif: '',
        queryIndices: '',
        templateIndices: ''
    };
    
    af3Templates.push(template);
    renderAf3Templates();
    updateOutput();
}

function renderAf3Templates() {
    const container = document.getElementById('af3TemplatesList');
    container.innerHTML = '';
    
    af3Templates.forEach((template, index) => {
        const templateDiv = document.createElement('div');
        templateDiv.className = 'af3-template-item';
        templateDiv.innerHTML = `
            <h4>Template ${index + 1}</h4>
            <div class="af3-template-fields">
                <div class="form-group">
                    <label>Chain ID:</label>
                    <select onchange="updateAf3Template('${template.id}', 'chainId', this.value)">
                        <option value="">Select Chain...</option>
                        ${components.filter(comp => comp.type === 'protein').map(comp => `<option value="${comp.chainId}" ${comp.chainId === template.chainId ? 'selected' : ''}>${comp.chainId} (protein)</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>mmCIF Content:</label>
                    <textarea placeholder="Enter mmCIF content..." 
                              onchange="updateAf3Template('${template.id}', 'mmcif', this.value)"
                              style="min-height: 80px; font-family: monospace;">${template.mmcif}</textarea>
                </div>
                <div class="template-mapping">
                    <h5>Index Mapping</h5>
                    <div class="indices-row">
                        <div class="form-group">
                            <label>Query Indices (comma-separated, 0-based):</label>
                            <input type="text" placeholder="0,1,2,3,4,5" 
                                   value="${template.queryIndices}"
                                   onchange="updateAf3Template('${template.id}', 'queryIndices', this.value)">
                        </div>
                        <div class="form-group">
                            <label>Template Indices (comma-separated, 0-based):</label>
                            <input type="text" placeholder="0,1,2,3,4,5" 
                                   value="${template.templateIndices}"
                                   onchange="updateAf3Template('${template.id}', 'templateIndices', this.value)">
                        </div>
                    </div>
                </div>
            </div>
            <button onclick="removeAf3Template('${template.id}')" class="btn btn-danger btn-sm" style="position: absolute; top: 15px; right: 15px;">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(templateDiv);
    });
}

function updateAf3Template(templateId, field, value) {
    const template = af3Templates.find(t => t.id === templateId);
    if (template) {
        template[field] = value;
        updateOutput();
    }
}

function removeAf3Template(templateId) {
    af3Templates = af3Templates.filter(t => t.id !== templateId);
    renderAf3Templates();
    updateOutput();
}

// Bonded Atom Pairs Management
function addBondedAtomPair() {
    const pairId = 'bonded_pair_' + Date.now();
    const pair = {
        id: pairId,
        atom1: { chainId: '', residueId: 1, atomName: '' },
        atom2: { chainId: '', residueId: 1, atomName: '' }
    };
    
    bondedAtomPairs.push(pair);
    renderBondedAtomPairs();
    updateOutput();
}

function renderBondedAtomPairs() {
    const container = document.getElementById('bondedAtomPairsList');
    container.innerHTML = '';
    
    bondedAtomPairs.forEach((pair, index) => {
        const pairDiv = document.createElement('div');
        pairDiv.className = 'bonded-pair-item';
        pairDiv.innerHTML = `
            <h4>Bonded Atom Pair ${index + 1}</h4>
            <div class="bonded-pair-fields">
                <div class="atom-pair">
                    <h5>Atom 1</h5>
                    <div class="form-group">
                        <label>Chain ID:</label>
                        <select onchange="updateBondedAtomPair('${pair.id}', 'atom1', 'chainId', this.value)">
                            <option value="">Select Chain...</option>
                            ${components.map(comp => `<option value="${comp.chainId}" ${comp.chainId === pair.atom1.chainId ? 'selected' : ''}>${comp.chainId} (${comp.type})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Residue ID:</label>
                        <input type="number" value="${pair.atom1.residueId}" min="1" 
                               onchange="updateBondedAtomPair('${pair.id}', 'atom1', 'residueId', parseInt(this.value))">
                    </div>
                    <div class="form-group">
                        <label>Atom Name:</label>
                        <input type="text" value="${pair.atom1.atomName}" placeholder="e.g., CA, SG, O6" 
                               onchange="updateBondedAtomPair('${pair.id}', 'atom1', 'atomName', this.value)">
                    </div>
                </div>
                <div class="atom-pair">
                    <h5>Atom 2</h5>
                    <div class="form-group">
                        <label>Chain ID:</label>
                        <select onchange="updateBondedAtomPair('${pair.id}', 'atom2', 'chainId', this.value)">
                            <option value="">Select Chain...</option>
                            ${components.map(comp => `<option value="${comp.chainId}" ${comp.chainId === pair.atom2.chainId ? 'selected' : ''}>${comp.chainId} (${comp.type})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Residue ID:</label>
                        <input type="number" value="${pair.atom2.residueId}" min="1" 
                               onchange="updateBondedAtomPair('${pair.id}', 'atom2', 'residueId', parseInt(this.value))">
                    </div>
                    <div class="form-group">
                        <label>Atom Name:</label>
                        <input type="text" value="${pair.atom2.atomName}" placeholder="e.g., CA, SG, C1" 
                               onchange="updateBondedAtomPair('${pair.id}', 'atom2', 'atomName', this.value)">
                    </div>
                </div>
            </div>
            <button onclick="removeBondedAtomPair('${pair.id}')" class="btn btn-danger btn-sm" style="position: absolute; top: 15px; right: 15px;">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(pairDiv);
    });
}

function updateBondedAtomPair(pairId, atomKey, field, value) {
    const pair = bondedAtomPairs.find(p => p.id === pairId);
    if (pair) {
        pair[atomKey][field] = value;
        updateOutput();
    }
}

function removeBondedAtomPair(pairId) {
    bondedAtomPairs = bondedAtomPairs.filter(p => p.id !== pairId);
    renderBondedAtomPairs();
    updateOutput();
}