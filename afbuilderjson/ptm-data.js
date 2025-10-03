// Post-translational modification data
// Post-translational modification data
const PTM_DATA = {
  // Common PTMs for each amino acid
  'A': [
    { code: 'ALA', name: 'Alanine (unmodified)' },
    { code: 'AYA', name: 'N-acetyl-alanine' } // corrected from ALY -> AYA
  ],
  'C': [
    { code: 'CYS', name: 'Cysteine (unmodified)' },
    { code: 'CYX', name: 'Cysteine disulfide bridge' },
    { code: 'CSO', name: 'S-hydroxycysteine' },             // sulfenic acid
    { code: 'OCS', name: 'Cysteinesulfonic acid' },         // sulfonic acid
    { code: 'MCS', name: 'Malonyl cysteine' },              // requested
    { code: 'P1L', name: 'S-Palmitoyl-L-cysteine' },        // requested
    { code: 'SNC', name: 'S-Nitroso-cysteine' }             // requested
  ],
  'D': [
    { code: 'ASP', name: 'Aspartic acid (unmodified)' },
    { code: 'ASX', name: 'Asparagine or aspartic acid' },
    { code: 'SNN', name: 'L-3-Aminosuccinimide' }           // requested (deamidation intermediate)
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
    { code: 'HID', name: 'Histidine delta-protonated' },     // non-CCD, force-field style
    { code: 'HIE', name: 'Histidine epsilon-protonated' },   // non-CCD, force-field style
    { code: 'HIP', name: 'ND1-Phosphonohistidine' },         // requested (CCD meaning)
    { code: 'NEP', name: 'N1-Phosphonohistidine' }           // requested
  ],
  'I': [
    { code: 'ILE', name: 'Isoleucine (unmodified)' }
  ],
  'K': [
    { code: 'LYS', name: 'Lysine (unmodified)' },
    { code: 'KCX', name: 'Lysine NZ-carboxylic acid' },
    { code: 'ALY', name: 'N6-Acetyl-L-lysine' },            // requested
    { code: 'MLZ', name: 'N6-Methyllysine' },               // mono-methyl
    { code: 'MLY', name: 'N-Dimethyl-lysine' },             // di-methyl
    { code: 'M3L', name: 'N-Trimethyl-lysine' },            // tri-methyl
    { code: 'LYZ', name: '5-Hydroxylysine' },               // requested
    { code: 'KCR', name: 'N-6-Crotonyl-L-lysine' },         // requested
    { code: 'YHA', name: 'Homocitrulline (N6-carbamoyl-L-lysine)' } // requested
  ],
  'L': [
    { code: 'LEU', name: 'Leucine (unmodified)' }
  ],
  'M': [
    { code: 'MET', name: 'Methionine (unmodified)' },
    { code: 'MSE', name: 'Selenomethionine' }
  ],
  'N': [
    { code: 'ASN', name: 'Asparagine (unmodified)' },
    { code: 'AHB', name: '3-Hydroxyasparagine' }            // requested
  ],
  'P': [
    { code: 'PRO', name: 'Proline (unmodified)' },
    { code: 'HYP', name: '4-Hydroxyproline' },              // requested
    { code: 'HY3', name: '3-Hydroxyproline' }               // requested
  ],
  'Q': [
    { code: 'GLN', name: 'Glutamine (unmodified)' }
  ],
  'R': [
    { code: 'ARG', name: 'Arginine (unmodified)' },
    { code: '2MR', name: 'N3,N4-Dimethyl-L-arginine' },     // SDMA (requested)
    { code: 'AGM', name: '5-Methyl-L-arginine' },           // requested
    { code: 'CIR', name: 'Citrulline' }                     // requested (correct code)
  ],
  'S': [
    { code: 'SER', name: 'Serine (unmodified)' },
    { code: 'SEP', name: 'Phosphoserine' }                  // requested
    // removed TPO duplicate here; it stays under 'T'
  ],
  'T': [
    { code: 'THR', name: 'Threonine (unmodified)' },
    { code: 'TPO', name: 'Phosphothreonine' }               // requested
  ],
  'V': [
    { code: 'VAL', name: 'Valine (unmodified)' }
  ],
  'W': [
    { code: 'TRP', name: 'Tryptophan (unmodified)' },
    { code: 'TRF', name: 'N1-Formyl-tryptophan' }           // requested
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