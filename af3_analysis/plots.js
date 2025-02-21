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
        margin: { t: 50, b: 50, l: 50, r: 50 }
    };

    const finalLayout = Object.assign({}, fig.layout, layoutUpdates);
    
    Plotly.newPlot(paeDiv, fig.data, finalLayout);
}

function drawPLDDTPlot(modelData) {
    console.log('Drawing pLDDT plot with data:', modelData);
    const traces = Array.from(modelData.entries()).map(([modelNum, data]) => ({
        y: data.plddts,
        name: `Model ${modelNum}`,
        type: 'scatter',
        mode: 'lines'
    }));

    Plotly.newPlot('pLDDTPlot', traces, {
        title: 'pLDDT Scores',
        yaxis: {
            title: 'pLDDT',
            range: [0, 100]
        },
        xaxis: {
            title: 'Residue Index'
        }
    });
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
