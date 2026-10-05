---
title: "Norovirus capsid self-assembly"
summary: "From a single VP1 dimer to a full icosahedral capsid: PhD work combining modelling, SAXS and cryo-EM to understand how norovirus capsids grow."
status: "Completed"
period: "2014 — 2017 · PhD, I2BC"
order: 5
image: /assets/images/research/capsid.jpg
collaborators: ["Dr. Stéphane Bressanelli (I2BC)", "Dr. Yves Boulard (I2BC)", "Dr. Jean Lepault (I2BC)"]
related_tools:
  - name: "TTClust"
    url: https://github.com/tubiana/TTClust
related_publications:
  - label: "Dynamics and asymmetry in the dimer of the norovirus major capsid protein (PLoS ONE, 2017)"
    url: "https://doi.org/10.1371/journal.pone.0182056"
  - label: "Studying self-assembly of norovirus capsid by a combination of in silico methods (bioRxiv, 2024)"
    url: "https://doi.org/10.1101/2024.01.21.575142"
---

Norovirus causes acute gastroenteritis and is built from 90 dimers of a
single structural protein, VP1. My PhD asked how that capsid actually
assembles.

Modelling the VP1 dimer for both a human strain (with a known capsid
structure) and a bovine strain (with only SAXS data), I found that the dimer
adopts a markedly different conformation free in solution versus assembled
in the capsid — validated experimentally by SAXS. Working with normal-mode
analysis and coarse-grained (MARTINI) simulations of the proposed
pentamer-of-dimers assembly intermediate, together with Jean-Charles
Carvaillo (whom I co-supervised), we then used a growth protocol combining
protein-protein docking with molecular dynamics to show that capsid growth
from this intermediate is anisotropic — contradicting the isotropic growth
model originally proposed alongside the 1999 capsid structure. Separately,
using cryo-EM maps from Dr. Jean Lepault, I modelled the capsid of a bovine
genogroup (GIII.2) by flexible fitting, revealing that its spicule domain is
more conformationally flexible than the human strain's.

Along the way I wrote **TTClust**, a molecular-dynamics trajectory
clustering tool built to make sense of these simulations — now one of the
most widely used pieces of software I've released.
