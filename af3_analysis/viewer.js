let viewer;

async function initMolstarViewer(containerId) {
    console.log('Initializing Molstar viewer...');
    console.log('molstar object:', window.molstar);

    // Check if molstar object is available
    if (!window.molstar || !molstar.Viewer || typeof molstar.Viewer.create !== 'function') {
        console.error('Molstar script not loaded or not available');
        return;
    }

    const containerElement = document.getElementById(containerId);
    if (!containerElement) {
        console.error(`Element with id '${containerId}' not found`);
        return;
    }

    try {
        // Create viewer using the original Molstar API with async/await
        viewer = await molstar.Viewer.create(containerId, { 
            layoutIsExpanded: false, 
            layoutShowControls: false 
        });
        console.log('Viewer created');

        // Load PDB from URL using fetch and builders
        try {
            //const req = await fetch('https://files.rcsb.org/download/1CRN.cif');
            //const pdbData = await req.text();
            // console.log("PDB:", pdbData);

            // Load the data into Molstar
            // await viewer.loadStructureFromData(pdbData, 'mmcif');
            console.log('Structure loaded successfully from URL using fetch');
        } catch (e) {
            console.error("Error loading structure from URL:", e);
        }

    } catch (err) {
        console.error('Error initializing Molstar viewer:', err);
    }

    return viewer;
}

async function loadStructureFromData(dataStr, format, clearData = true) {
    if (!viewer) {
        console.error('Viewer not initialized');
        return;
    }

    try {
        // Clear previous models
        if (clearData) {
            viewer.plugin.clear();
        }

        await viewer.loadStructureFromData(dataStr, format);
        console.log('Structure loaded from data successfully');
    } catch (err) {
        console.error('Error loading structure from data:', err);
    }
}

function updateColorTheme(themeName) {
    if (!viewer) {
        console.error('Viewer not initialized');
        return;
    }

    console.log('Updating color theme to:', themeName);
    
    try {
        // Get all structures
        const structures = viewer.plugin.managers.structure.hierarchy.current.structures;
        
        
        if (!structures || structures.length === 0) {
            console.error('No structures available');
            return;
        }
        
        // Update each structure's components with the new color theme
        for (const structure of structures) {
            if (!structure.components || structure.components.length === 0) {
                console.error('No components found for structure');
                continue;
            }
            
            // Update all components at once with the new color theme
            viewer.plugin.managers.structure.component.updateRepresentationsTheme(
                structure.components, 
                { color: themeName }
            );
        }
        console.log('Color theme updated successfully for all structures');
    } catch (err) {
        console.error('Error updating color theme:', err);
    }
}

window.Viewer = {
    init: initMolstarViewer,
    loadStructureFromData: loadStructureFromData,
    updateColorTheme: updateColorTheme,
    getInstance: () => viewer
};

console.log('window.Viewer object created');
