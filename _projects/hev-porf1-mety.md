---
title: "HEV pORF1: structure and domain organization"
summary: "AlphaFold-based modelling revised the domain map of HEV's replication polyprotein ORF1 — five domains, not six, and no protease domain."
status: "Ongoing"
period: "2022 — present"
order: 2
image: /assets/images/gallery/AF_GOODSELL-STYLE_233_signed.png
collaborators: ["Dr. Stéphane Bressanelli (I2BC)", "Dr. Sonia Fieulaine (I2BC)", "Dr. Chantal Prévost (IBPC)", "Dr. Sandhya Tiwari (Osaka University)", "Dr. André Gömer (Ruhr University Bochum)"]
related_tools:
  - name: "ORF1viewer"
    url: /ORF1viewer/
related_publications:
  - label: "De novo modelling of HEV replication polyprotein: five-domain breakdown and involvement of flexibility in functional regulation (Virology, 2023)"
    url: "https://doi.org/10.1016/j.virol.2022.12.002"
  - label: "Hepatitis E virus RNA replication polyprotein: taking structural biology seriously (Front. Microbiol., 2023)"
    url: "https://doi.org/10.3389/fmicb.2023.1254741"
  - label: "Functional study of two flexible regions of the hepatitis E virus ORF1 replicase (PLoS ONE, 2026)"
    url: "https://doi.org/10.1371/journal.pone.0343555"
---

HEV's replication polyprotein ORF1 (pORF1, ~1700 residues, 186 kDa) carries
the viral RNA polymerase and is essential to replication, but its size,
multi-domain architecture and membrane-associated regions make it very hard
to produce with standard expression systems — which had long kept it out of
reach of structural biology.

Working from a soluble form of pORF1 that Dr. Sonia Fieulaine developed using
an atypical cell-free expression system, and combining cryo-EM with
AlphaFold-based modelling, I revised the domain map first proposed by Koonin
in 1992. Rather than the six domains and canonical protease originally
proposed, the models show **five domains** organized into two modules
separated by a hypervariable region — and no protease domain at all: the
region long annotated as a papain-like protease is in fact a
fatty-acid-binding-domain (FABD)-like fold. The N-terminal Met and Y domains,
previously described separately, are better understood as a single domain I
named **MetY**, homologous to the alphavirus protein nsP1.

I'm now extending this domain classification across HEV genotypes and host
species, to help clarify the zoonotic risk of animal-to-human transmission
and settle the long-running debate over a putative ORF1 protease.

MetY's homology to nsP1 also suggested it might oligomerize into a
membrane-binding pore — a hypothesis I'm testing computationally with
Dr. Chantal Prévost (IBPC), alongside preliminary experimental evidence of
membrane interaction from Dr. Sonia Fieulaine, with Gabriel Vanegas Arias
(PhD student I co-supervise) now extending this work. The
[ORF1 viewer]({{ '/ORF1viewer/' | relative_url }}) lets you explore these
AlphaFold models across HEV species and genotypes interactively.
