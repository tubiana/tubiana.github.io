// Post-translational modification data
const PTM_DATA = {
    // Common PTMs for each amino acid
    'A': [
        { code: 'ALA', name: 'Alanine (unmodified)' },
        { code: 'ALY', name: 'N-acetyl-alanine' }
    ],
    'C': [
        { code: 'CYS', name: 'Cysteine (unmodified)' },
        { code: 'CYX', name: 'Cysteine disulfide bridge' },
        { code: 'CSO', name: 'S-hydroxycysteine' },
        { code: 'OCS', name: 'Cysteinesulfenic acid' }
    ],
    'D': [
        { code: 'ASP', name: 'Aspartic acid (unmodified)' },
        { code: 'ASX', name: 'Asparagine or aspartic acid' }
    ],
    'E': [
        { code: 'GLU', name: 'Glutamic acid (unmodified)' },
        { code: 'GLX', name: 'Glutamine or glutamic acid' }
    ],
    'F': [
        { code: 'PHE', name: 'Phenylalanine (unmodified)' },
        { code: 'PHI', name: 'Iodophenylalanine' }
    ],
    'G': [
        { code: 'GLY', name: 'Glycine (unmodified)' }
    ],
    'H': [
        { code: 'HIS', name: 'Histidine (unmodified)' },
        { code: 'HID', name: 'Histidine delta-protonated' },
        { code: 'HIE', name: 'Histidine epsilon-protonated' },
        { code: 'HIP', name: 'Histidine doubly protonated' }
    ],
    'I': [
        { code: 'ILE', name: 'Isoleucine (unmodified)' }
    ],
    'K': [
        { code: 'LYS', name: 'Lysine (unmodified)' },
        { code: 'KCX', name: 'Lysine NZ-carboxylic acid' },
        { code: 'ALY', name: 'N-acetyllysine' },
        { code: 'MLY', name: 'N-dimethyl-lysine' },
        { code: 'M3L', name: 'N-trimethyl-lysine' }
    ],
    'L': [
        { code: 'LEU', name: 'Leucine (unmodified)' }
    ],
    'M': [
        { code: 'MET', name: 'Methionine (unmodified)' },
        { code: 'MSE', name: 'Selenomethionine' }
    ],
    'N': [
        { code: 'ASN', name: 'Asparagine (unmodified)' }
    ],
    'P': [
        { code: 'PRO', name: 'Proline (unmodified)' },
        { code: 'HYP', name: 'Hydroxyproline' }
    ],
    'Q': [
        { code: 'GLN', name: 'Glutamine (unmodified)' }
    ],
    'R': [
        { code: 'ARG', name: 'Arginine (unmodified)' },
        { code: 'CIT', name: 'Citrulline' }
    ],
    'S': [
        { code: 'SER', name: 'Serine (unmodified)' },
        { code: 'SEP', name: 'Phosphoserine' },
        { code: 'TPO', name: 'Phosphothreonine' }
    ],
    'T': [
        { code: 'THR', name: 'Threonine (unmodified)' },
        { code: 'TPO', name: 'Phosphothreonine' }
    ],
    'V': [
        { code: 'VAL', name: 'Valine (unmodified)' }
    ],
    'W': [
        { code: 'TRP', name: 'Tryptophan (unmodified)' }
    ],
    'Y': [
        { code: 'TYR', name: 'Tyrosine (unmodified)' },
        { code: 'PTR', name: 'Phosphotyrosine' },
        { code: 'TYS', name: 'Sulfotyrosine' }
    ]
};

// Function to get PTM options for a specific amino acid
function getPTMOptions(aminoAcid) {
    return PTM_DATA[aminoAcid.toUpperCase()] || [];
}