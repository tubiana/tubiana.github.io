// Plotly makeSubplots polyfill
if (typeof Plotly.makeSubplots !== 'function') {
    Plotly.makeSubplots = function(options) {
        const rows = options.rows, cols = options.cols;
        const hSpacing = options.horizontal_spacing || 0;
        const vSpacing = options.vertical_spacing || 0;
        let layout = {};
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c + 1;
                const x0 = c / cols + hSpacing / 2;
                const x1 = (c + 1) / cols - hSpacing / 2;
                const y0 = 1 - (r + 1) / rows + vSpacing / 2;
                const y1 = 1 - r / rows - vSpacing / 2;
                const xKey = i === 1 ? 'xaxis' : 'xaxis' + i;
                const yKey = i === 1 ? 'yaxis' : 'yaxis' + i;
                layout[xKey] = { domain: [x0, x1], anchor: yKey };
                layout[yKey] = { domain: [y0, y1], anchor: xKey };
            }
        }
        
        if (options.subplot_titles) {
            layout.annotations = options.subplot_titles.map((title, index) => ({
                text: title,
                x: (index % cols) / cols + 0.5/cols,
                y: 1 - Math.floor(index / cols) / rows,
                xref: 'paper',
                yref: 'paper',
                showarrow: false,
                font: { size: 14 }
            }));
        }
        
        return { data: [], layout: layout };
    };
}

function drawPAEMatrices(modelData) {
    console.log('Drawing PAE matrices with data:', modelData);
    const paeDiv = document.getElementById('paeMatrices');
    const modelEntries = Array.from(modelData.entries());
    const numPlots = modelEntries.length;
    if (numPlots === 0) return;

    const cols = 3;
    const rows = Math.ceil(numPlots / cols);
    const subplotTitles = modelEntries.map(([modelNum]) => `Model ${modelNum}`);
    
    // Create the subplot figure using our polyfill
    const fig = Plotly.makeSubplots({
        rows, cols,
        subplot_titles: subplotTitles,
        horizontal_spacing: 0.05,
        vertical_spacing: 0.1
    });
    
    // Find chain boundaries for the first model data (assuming similar structure for all models)
    const firstModelData = modelEntries[0][1];
    const chainBoundaries = findChainBoundariesForPAE(firstModelData);
    console.log('Chain boundaries for PAE:', chainBoundaries);
    
    // Get the matrix size from the first model
    const matrixSize = firstModelData.pae.length;
    
    // Loop over each model, assign axis names, and push the trace into fig.data
    modelEntries.forEach(([modelNum, data], i) => {
        const trace = {
            z: data.pae,
            type: 'heatmap',
            colorscale: [
                [0, 'rgb(0,0,255)'],
                [0.5, 'rgb(255,255,255)'],
                [1, 'rgb(255,0,0)']
            ],
            zmin: 0,
            zmax: 30,
            showscale: i === 0,
            hoverongaps: false
        };
        
        // Use 'x'/'y' for the first and 'x2','y2', etc. for others
        trace.xaxis = i === 0 ? 'x' : 'x' + (i + 1);
        trace.yaxis = i === 0 ? 'y' : 'y' + (i + 1);

        fig.data.push(trace);
    });
    
    const layoutUpdates = {
        height: 400 * rows,
        showlegend: false,
        margin: { t: 50, b: 50, l: 50, r: 50 },
        shapes: []
    };

    // Add chain boundary lines to each subplot
    for (let i = 0; i < numPlots; i++) {
        const rowNum = Math.floor(i / cols) + 1;
        const colNum = (i % cols) + 1;
        const xref = i === 0 ? 'x' : `x${i + 1}`;
        const yref = i === 0 ? 'y' : `y${i + 1}`;
        
        // Add vertical lines for chain boundaries
        chainBoundaries.forEach(boundary => {
            // Vertical line - make it more prominent
            layoutUpdates.shapes.push({
                type: 'line',
                x0: boundary,
                x1: boundary,
                y0: 0,
                y1: matrixSize, // Use the matrix size from the first model
                xref: xref,
                yref: yref,
                line: {
                    color: 'rgba(0,0,0,0.8)',
                    width: 4,
                    dash: 'solid'
                }
            });
            
            // Horizontal line - make it more prominent
            layoutUpdates.shapes.push({
                type: 'line',
                x0: 0,
                x1: matrixSize, // Use the matrix size from the first model
                y0: boundary,
                y1: boundary,
                xref: xref,
                yref: yref,
                line: {
                    color: 'rgba(0,0,0,0.8)',
                    width: 4,
                    dash: 'solid'
                }
            });
        });
    }

    const finalLayout = Object.assign({}, fig.layout, layoutUpdates);
    
    Plotly.newPlot(paeDiv, fig.data, finalLayout);
}

// Helper function to find chain boundaries in PAE data
function findChainBoundariesForPAE(data) {
    // Find where chain IDs change
    const chainChanges = [];
    let currentChain = data.chainIds[0];
    let residueCount = 0;
    let atomsPerResidue = 0;
    
    // First count atoms per residue by examining the pattern
    // Typical amino acids have ~10 atoms (backbone + side chain)
    let atomsFound = 0;
    for (let i = 0; i < Math.min(100, data.chainIds.length); i++) {
        atomsFound++;
        if (i > 5 && i % atomsFound === 0) {
            // Found a pattern - use this as estimated atoms per residue
            atomsPerResidue = atomsFound;
            break;
        }
    }
    
    // If we couldn't detect atoms per residue, use default of 10
    if (atomsPerResidue === 0 || atomsPerResidue > 15) atomsPerResidue = 10;
    console.log(`Detected approximately ${atomsPerResidue} atoms per residue`);
    
    // Now detect chain changes and convert to residue positions
    for (let i = 0; i < data.chainIds.length; i++) {
        if (data.chainIds[i] !== currentChain) {
            const residuePosition = Math.floor(i / atomsPerResidue);
            chainChanges.push(residuePosition);
            currentChain = data.chainIds[i];
        }
    }
    
    // Scale to match PAE matrix size
    const estimatedTotalResidues = Math.ceil(data.chainIds.length / atomsPerResidue);
    const paeMatrixSize = data.pae.length;
    const scaleFactor = paeMatrixSize / estimatedTotalResidues;
    
    return chainChanges.map(pos => Math.round(pos * scaleFactor));
}

// New function to process pLDDT data for proteins/nucleic acids vs other molecules
function processPLDDTData(modelData) {
    const processedData = new Map();
    
    for (const [modelNum, data] of modelData.entries()) {
        // Initialize the processed data for this model
        const processed = {
            residueIndices: [],  // For plotting
            residuePLDDTs: [],   // Averaged pLDDTs per residue
            atomIndices: [],     // For non-protein/non-nucleic atoms
            atomPLDDTs: []       // Raw pLDDTs for non-protein/non-nucleic atoms
        };
        
        // Group pLDDT by residue
        const residueGroups = new Map(); // Map<residueId, Array<plddt>>
        const otherAtoms = {
            indices: [],
            plddts: []
        };
        
        // Process each atom's pLDDT
        for (let i = 0; i < data.plddts.length; i++) {
            const chainId = data.chainIds[i];
            const plddt = data.plddts[i];
            
            // Check if this is part of a protein/nucleic acid
            if (isProteinOrNucleicAcid(chainId)) {
                // Extract residue number from atom name or position
                const residueId = extractResidueId(i, chainId);
                
                if (!residueGroups.has(residueId)) {
                    residueGroups.set(residueId, []);
                }
                residueGroups.get(residueId).push(plddt);
            } else {
                // Keep atom-level pLDDT for other molecules
                otherAtoms.indices.push(i);
                otherAtoms.plddts.push(plddt);
            }
        }
        
        // Calculate average pLDDT per residue
        let currentResidueIndex = 0;
        for (const [residueId, plddts] of residueGroups.entries()) {
            const avgPLDDT = plddts.reduce((sum, val) => sum + val, 0) / plddts.length;
            processed.residueIndices.push(currentResidueIndex++);
            processed.residuePLDDTs.push(avgPLDDT);
        }
        
        // Add atom-level pLDDTs for other molecules
        processed.atomIndices = otherAtoms.indices;
        processed.atomPLDDTs = otherAtoms.plddts;
        
        processedData.set(modelNum, processed);
    }
    
    return processedData;
}

// Helper function to determine if an atom belongs to protein or nucleic acid
// You'll need to adjust this based on the actual format of chainIds
function isProteinOrNucleicAcid(chainId) {
    // This is a placeholder - you'll need to implement based on your data
    // For example, check for standard amino acid or nucleotide codes
    return true; // Default to true for now
}

// Helper function to extract residue ID from atom data
// You'll need to adjust this based on your CIF file structure
function extractResidueId(atomIndex, chainId) {
    // This is a placeholder - you'll need to implement based on your data
    // For example, extract from atom name like "CA 123" to get residue number 123
    return Math.floor(atomIndex / 10); // Just a placeholder calculation
}

// Enhanced pLDDT plotting function with chain boundaries
function drawPLDDTPlot(modelData) {
    console.log('Drawing pLDDT plot with data:', modelData);
    
    try {
        // Group pLDDT values by residue for each model
        const residueData = processResidueData(modelData);
        
        // Create traces for plotting
        const traces = [];
        
        // Add a trace for each model
        for (const [modelNum, data] of residueData.entries()) {
            traces.push({
                x: data.residueIndices,
                y: data.residuePLDDTs,
                name: `Model ${modelNum}`,
                type: 'scatter',
                mode: 'lines',
                hoverinfo: 'y+text',
                text: data.residueLabels,
                line: {
                    width: 2
                }
            });
        }
        
        // Find chain boundaries for the first model
        const firstModelData = residueData.get(Array.from(residueData.keys())[0]);
        const chainBoundaries = findChainBoundariesForPLDDT(firstModelData);
        console.log('Chain boundaries for pLDDT:', chainBoundaries);
        
        // Create vertical line shapes for chain boundaries
        const shapes = chainBoundaries.map(position => ({
            type: 'line',
            x0: position,
            x1: position,
            y0: 0,
            y1: 100,
            line: {
                color: 'black',
                width: 2
            }
        }));
        
        // Plot the data
        Plotly.newPlot('pLDDTPlot', traces, {
            title: 'pLDDT Scores by Residue',
            yaxis: {
                title: 'pLDDT',
                range: [0, 100]
            },
            xaxis: {
                title: 'Residue Number'
            },
            legend: {
                orientation: 'h',
                y: -0.2
            },
            shapes: shapes
        });
    } catch (error) {
        console.error('Error processing pLDDT data:', error);
    }
}

// Process the raw data to get per-residue pLDDT averages
function processResidueData(modelData) {
    const residueData = new Map();
    
    for (const [modelNum, data] of modelData.entries()) {
        // Initialize data for this model
        const processedData = {
            residueIndices: [], 
            residuePLDDTs: [],
            residueLabels: []
        };
        
        // Extract residue information and group pLDDTs by residue
        const residueGroups = new Map(); // Map<chainId_residueNum, {sum, count}>
        
        // Step 1: Find the pattern of residue boundaries
        const residueBoundaries = findResidueBoundaries(data.chainIds);
        console.log(`Model ${modelNum}: Found ${residueBoundaries.length} residue boundaries`);
        
        // Step 2: Process each atom's pLDDT and assign to residue
        let currentResidueNum = 1;
        let currentChain = data.chainIds[0];
        let residueStartIdx = 0;
        
        for (let i = 0; i < data.plddts.length; i++) {
            const chainId = data.chainIds[i];
            const plddt = data.plddts[i];
            
            // Check if we've crossed a residue boundary
            if (i > 0 && residueBoundaries.includes(i)) {
                currentResidueNum++;
                
                // If chain changed, reset residue numbering
                if (chainId !== currentChain) {
                    currentResidueNum = 1;
                    currentChain = chainId;
                }
                
                residueStartIdx = i;
            }
            
            // Create a unique key for each residue (chain + residue number)
            const residueKey = `${chainId}_${currentResidueNum}`;
            
            if (!residueGroups.has(residueKey)) {
                residueGroups.set(residueKey, { 
                    sum: 0, 
                    count: 0, 
                    chain: chainId, 
                    resNum: currentResidueNum 
                });
            }
            
            // Add this atom's pLDDT to the residue's total
            const residueData = residueGroups.get(residueKey);
            residueData.sum += plddt;
            residueData.count += 1;
        }
        
        // Convert residue groups to arrays for plotting
        // Sort by chain then by residue number
        const sortedResidues = Array.from(residueGroups.values())
            .sort((a, b) => {
                if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
                return a.resNum - b.resNum;
            });
        
        // Calculate average pLDDT per residue
        for (let i = 0; i < sortedResidues.length; i++) {
            const residue = sortedResidues[i];
            const avgPLDDT = residue.sum / residue.count;
            
            processedData.residueIndices.push(i + 1); // 1-based index for residues
            processedData.residuePLDDTs.push(avgPLDDT);
            processedData.residueLabels.push(`Chain ${residue.chain}, Residue ${residue.resNum}`);
        }
        
        residueData.set(modelNum, processedData);
    }
    
    return residueData;
}

// Function to identify residue boundaries based on atom patterns
function findResidueBoundaries(chainIds) {
    const boundaries = [];
    
    // In CIF files, atoms within a residue follow a fairly standard pattern
    // This is a simplified approach that looks for repeating patterns of atom names
    // by detecting where one residue ends and another begins
    
    // For typical amino acids, the pattern is: N, CA, C, O, and then side chain atoms
    // When we see a new "N" atom after other atoms, it's likely a new residue
    
    let currentChain = chainIds[0];
    
    for (let i = 1; i < chainIds.length; i++) {
        // If chain changes, it's definitely a new residue
        if (chainIds[i] !== currentChain) {
            boundaries.push(i);
            currentChain = chainIds[i];
            continue;
        }
        
        // Special rule for chain transitions
        if (i < chainIds.length - 1 && chainIds[i] !== chainIds[i+1]) {
            boundaries.push(i+1);
        }
        
        // For the same chain, we check the atom pattern
        // In AlphaFold CIF files, each residue has around 7-14 atoms depending on the amino acid
        // For simplicity, we'll use a heuristic based on examining several AF structures
        if (i % 8 === 0) { // Approximate residue boundary - this will be refined later
            boundaries.push(i);
        }
    }
    
    // Remove duplicates and sort
    return Array.from(new Set(boundaries)).sort((a, b) => a - b);
}

// Helper function to find chain boundaries in pLDDT data
function findChainBoundariesForPLDDT(data) {
    const boundaries = [];
    let currentChain = null;
    
    // Detect chain changes from residue labels
    data.residueLabels.forEach((label, index) => {
        const chain = label.split(',')[0].split(' ')[1];
        if (chain !== currentChain) {
            boundaries.push(index);
            currentChain = chain;
        }
    });
    
    return boundaries;
}

// Helper functions
function findChainBoundaries(chainIds) {
    const boundaries = [];
    let currentChain = chainIds[0];
    chainIds.forEach((chain, index) => {
        if (chain !== currentChain) {
            boundaries.push(index);
            currentChain = chain;
        }
    });
    return boundaries;
}

window.Plots = {
    drawPAEMatrices,
    drawPLDDTPlot
};
