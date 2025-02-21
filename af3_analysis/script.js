const modelData = new Map();
let modelFiles = [];

async function handleFileUpload(event) {
    event.preventDefault();
    console.log('File upload triggered');
    const file = event.type === 'drop' ? event.dataTransfer.files[0] : event.target.files[0];

    if (!file || !file.name.endsWith('.zip')) {
        alert('Please upload a ZIP file');
        return;
    }

    try {
        document.body.style.cursor = 'wait';
        console.log('Loading zip file:', file.name);
        const zip = await JSZip.loadAsync(file);

        // Clear previous data
        modelData.clear();
        modelFiles = [];
        const dataFiles = [];

        // Sort and process files
        for (const [filename, fileEntry] of Object.entries(zip.files)) {
            if (!fileEntry.dir) {  // Skip directories
                if (filename.endsWith('.cif')) {
                    console.log('Found CIF file:', filename);
                    modelFiles.push([filename, fileEntry]);
                } else if (filename.includes('_full_data_')) {
                    console.log('Found data file:', filename);
                    dataFiles.push([filename, fileEntry]);
                }
            }
        }

        if (dataFiles.length === 0) {
            throw new Error('No data files found in ZIP');
        }

        // Process data files and build modelData
        for (const [filename, fileEntry] of dataFiles) {
            try {
                console.log('Processing data file:', filename);
                const content = await fileEntry.async('string');
                const data = JSON.parse(content);
                console.log(`For ${filename}: chainIds=${data.atom_chain_ids?.length}, plddts=${data.atom_plddts?.length}, pae=${data.pae?.length}`);

                // Validate data structure
                if (!data.atom_chain_ids || !data.atom_plddts || !data.pae) {
                    console.error('Invalid data structure in file:', filename);
                    continue;
                }

                const modelNum = filename.match(/_full_data_(\d+)\.json$/);
                if (!modelNum) {
                    console.error('Could not extract model number from filename:', filename);
                    continue;
                }

                modelData.set(modelNum[1], {
                    chainIds: data.atom_chain_ids,
                    plddts: data.atom_plddts,
                    pae: data.pae
                });
                console.log(`Successfully loaded model ${modelNum[1]}`);
            } catch (err) {
                console.error('Error processing file:', filename, err);
            }
        }

        // Populate the model selector dropdown
        populateModelSelector();

        // Load the first model's CIF data using loadStructureFromData
        if (modelFiles.length > 0) {
            console.log('Loading structure from first model\'s CIF data...');
            const [modelFilename, modelFileEntry] = modelFiles[0];
            const cifContent = await modelFileEntry.async('string');
            // console.log("CIF Content:", cifContent);
            try {
                await window.Viewer.loadStructureFromData(cifContent, 'mmcif');
                console.log(`Structure loaded from data for model file: ${modelFilename}`);
            } catch (e) {
                console.error("Error loading structure from data:", e);
            }
        }

        // Draw plots if we have data
        if (modelData.size > 0) {
            console.log('Drawing plots with', modelData.size, 'models');
            window.Plots.drawPAEMatrices(modelData);
            window.Plots.drawPLDDTPlot(modelData);
        } else {
            throw new Error('No valid model data could be loaded');
        }

    } catch (error) {
        console.error('Error processing file:', error);
        alert('Error processing file: ' + error.message);
    } finally {
        document.body.style.cursor = 'default';
    }
}

function populateModelSelector() {
    const modelSelector = document.getElementById('modelSelector');
    modelSelector.innerHTML = '<option value="">Select a model</option>';
    modelFiles.forEach(([filename], index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = filename;
        modelSelector.appendChild(option);
    });
}

async function handleModelChange(event) {
    const selectedIndex = event.target.value;
    if (selectedIndex === "") return;

    const [modelFilename, modelFileEntry] = modelFiles[selectedIndex];
    const cifContent = await modelFileEntry.async('string');
    // console.log("CIF Content:", cifContent);
    try {
        await window.Viewer.loadStructureFromData(cifContent, 'mmcif');
        console.log(`Structure loaded from data for model file: ${modelFilename}`);
    } catch (e) {
        console.error("Error loading structure from data:", e);
    }
}

async function handleLoadAllModels() {
    if (modelFiles.length === 0) return;

    try {
        // Clear previous models
        window.Viewer.getInstance().plugin.clear();

        for (const [modelFilename, modelFileEntry] of modelFiles) {
            const cifContent = await modelFileEntry.async('string');
            await window.Viewer.loadStructureFromData(cifContent, 'mmcif', false);
            console.log(`Structure loaded from data for model file: ${modelFilename}`);
        }
    } catch (e) {
        console.error("Error loading all models:", e);
    }
}

// async function handleSuperposeAllModels() {
//     if (modelFiles.length === 0) return;

//     try {
//         // Clear previous models
//         window.Viewer.getInstance().plugin.clear();

//         const urls = await Promise.all(modelFiles.map(async ([filename, fileEntry]) => URL.createObjectURL(new Blob([await fileEntry.async('blob')]))));

//         await window.Viewer.superposeModels(urls, 'mmcif');
//         console.log('All models superposed successfully');
//     } catch (e) {
//         console.error("Error superposing all models:", e);
//     }
// }

function setupDragAndDrop() {
    const dropZone = document.querySelector('.upload-section');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropZone.classList.add('highlight');
    }

    function unhighlight(e) {
        dropZone.classList.remove('highlight');
    }

    dropZone.addEventListener('drop', handleFileUpload, false);
}

// Simplified initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const uploadInput = document.getElementById('zipUpload');
        uploadInput.addEventListener('change', handleFileUpload);
        setupDragAndDrop();
        console.log('File upload initialized');

        // Initialize Molstar viewer
        console.log('Initializing Molstar after DOMContentLoaded...');
        const containerId = 'visualisationContent';
        await window.Viewer.init(containerId);

        // Add event listener for model selector
        const modelSelector = document.getElementById('modelSelector');
        modelSelector.addEventListener('change', handleModelChange);

        // Add event listener for load all models button
        const loadAllModelsButton = document.getElementById('loadAllModelsButton');
        loadAllModelsButton.addEventListener('click', handleLoadAllModels);

        // Add event listener for superpose all models button
        // const superposeAllModelsButton = document.getElementById('superposeAllModelsButton');
        // superposeAllModelsButton.addEventListener('click', handleSuperposeAllModels);

    } catch (error) {
        console.error('Initialization error:', error);
        alert('Failed to initialize: ' + error.message);
    }
});
