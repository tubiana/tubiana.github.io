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
            const req = await fetch('https://files.rcsb.org/download/1CRN.cif');
            const pdbData = await req.text();
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

// async function superposeModels(urls, format) {
//     if (!viewer) {
//         console.error('Viewer not initialized');
//         return;
//     }

//     try {
//         const data = await Promise.all(urls.map(url => viewer.builders.data.download({ url }, { state: { isGhost: true } })));
//         const trajectories = await Promise.all(data.map(d => viewer.builders.structure.parseTrajectory(d, format)));

//         await viewer.builders.structure.hierarchy.applyPreset(trajectories, 'default');
//         console.log('Models superposed successfully');
//     } catch (err) {
//         console.error('Error superposing models:', err);
//     }
// }

window.Viewer = {
    init: initMolstarViewer,
    loadStructureFromData: loadStructureFromData,
    // superposeModels: superposeModels,
    getInstance: () => viewer
};

console.log('window.Viewer object created');
