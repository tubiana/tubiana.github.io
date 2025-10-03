import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { DefaultPluginSpec, PluginSpec } from 'molstar/lib/mol-plugin/spec';
import { PluginConfig } from 'molstar/lib/mol-plugin/config';
import { Color } from 'molstar/lib/mol-util/color';
import { ColorTheme } from 'molstar/lib/mol-theme/color';
import { StructureElement } from 'molstar/lib/mol-model/structure';

let viewer: PluginContext;

const MySpec: PluginSpec = {
    ...DefaultPluginSpec(),
    config: [
        [PluginConfig.VolumeStreaming.Enabled, false]
    ]
};

async function initMolstarViewer(canvas: HTMLCanvasElement, parent: HTMLElement) {
    console.log('Initializing Molstar viewer (React-free)...');

    try {
        viewer = new PluginContext(MySpec);
        await viewer.init();

        if (!viewer.initViewer(canvas, parent)) {
            console.error('Failed to init Mol*');
            return;
        }

        // Load PDB from URL using fetch and builders
        try {
            const data = await viewer.builders.data.download({ url: 'https://files.rcsb.org/download/1CRN.pdb' }, { state: { isGhost: true } });
            const trajectory = await viewer.builders.structure.parseTrajectory(data, 'pdb');
            await viewer.builders.structure.hierarchy.applyPreset(trajectory, 'default');
            console.log('Structure loaded successfully from URL using fetch');
        } catch (e) {
            console.error("Error loading structure from URL:", e);
        }

    } catch (err) {
        console.error('Error initializing Molstar viewer:', err);
    }
    return viewer;
}

// New function to load structure from a data string
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

        // Use Mol* builders to create raw data
        const rawData = await viewer.builders.data.rawData({ data: dataStr }, { state: { isGhost: true } });
        if (!rawData) {
            throw new Error("Failed to create rawData");
        }
        // Parse the trajectory from the raw data
        const trajectory = await viewer.builders.structure.parseTrajectory(rawData, format);
        if (!trajectory) {
            throw new Error("Failed to create trajectory");
        }
        // Apply a default preset with B-factor color theme
        await viewer.builders.structure.hierarchy.applyPreset(trajectory, 'default', {
            representationParams: {
                theme: {
                    globalName: 'bfactor'
                }
            }
        });
        console.log('Structure loaded from data successfully');
    } catch (err) {
        console.error('Error loading structure from data:', err);
    }
}

async function superposeModels(urls, format) {
    if (!viewer) {
        console.error('Viewer not initialized');
        return;
    }

    try {
        const data = await Promise.all(urls.map(url => viewer.builders.data.download({ url }, { state: { isGhost: true } })));
        const trajectories = await Promise.all(data.map(d => viewer.builders.structure.parseTrajectory(d, format)));

        await viewer.builders.structure.hierarchy.applyPreset(trajectories, 'default');
        console.log('Models superposed successfully');
    } catch (err) {
        console.error('Error superposing models:', err);
    }
}

window.Viewer = {
    init: initMolstarViewer,
    loadStructureFromData: loadStructureFromData,
    superposeModels: superposeModels,
    getInstance: () => viewer
};

console.log('window.Viewer object created');
