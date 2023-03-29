const timestepElem = document.getElementById("timestep");
const simTimeElem = document.getElementById("sim-time");
const simTimeUnitElem = document.getElementById("sim-time-unit");
const simStepsElem = document.getElementById("sim-steps");
const outputIntervalElem = document.getElementById("output-interval");
const outputStepsElem = document.getElementById("output-steps");

function toFemtoseconds(value, unit) {
    switch (unit) {
        case "ps": return value * 1000;
        case "ns": return value * 1e6;
        case "ms": return value * 1e9;
        default: return value;
    }
}

function fromFemtoseconds(value, unit) {
    switch (unit) {
        case "ps": return value / 1000;
        case "ns": return value / 1e6;
        case "ms": return value / 1e9;
        default: return value;
    }
}

function calculateSimulationSteps() {
    const timestep = parseFloat(timestepElem.value);
    const simTime = parseFloat(simTimeElem.value);
    const simTimeUnit = simTimeUnitElem.value;

    const simTimeFs = toFemtoseconds(simTime, simTimeUnit);
    const steps = simTimeFs / timestep;

    simStepsElem.value = Math.round(steps);
}

function calculateSimulationTime() {
    const timestep = parseFloat(timestepElem.value);
    const simSteps = parseFloat(simStepsElem.value);
    const simTimeUnit = simTimeUnitElem.value;

    const simTimeFs = simSteps * timestep;
    const simTime = fromFemtoseconds(simTimeFs, simTimeUnit);

    simTimeElem.value = simTime.toFixed(2);
}

function calculateOutputSteps() {
    const timestep = parseFloat(timestepElem.value);
    const outputInterval = parseFloat(outputIntervalElem.value);

    const outputIntervalFs = toFemtoseconds(outputInterval, "ps");
    const steps = outputIntervalFs / timestep;

    outputStepsElem.textContent = Math.round(steps);
}

function onInputChange() {
    calculateSimulationSteps();
    calculateOutputSteps();
}

function onOutputChange() {
    calculateSimulationTime();
    calculateOutputSteps();
}

timestepElem.addEventListener("input", onInputChange);
simTimeElem.addEventListener("input", onInputChange);
simTimeUnitElem.addEventListener("change", onInputChange);
simStepsElem.addEventListener("input", onOutputChange);
outputIntervalElem.addEventListener("input", onInputChange);

onInputChange();

