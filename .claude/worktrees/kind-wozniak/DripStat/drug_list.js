// 500 common IV drugs used in US hospitals, organized by drug class
module.exports = [
  // ── Antibiotics: Penicillins ─────────────────────────────────────────────
  "ampicillin", "ampicillin-sulbactam", "nafcillin", "oxacillin",
  "piperacillin-tazobactam", "penicillin G",

  // ── Antibiotics: Cephalosporins ──────────────────────────────────────────
  "cefazolin", "cefepime", "cefotaxime", "cefoxitin", "ceftaroline",
  "ceftazidime", "ceftazidime-avibactam", "ceftolozane-tazobactam",
  "ceftriaxone", "cefuroxime",

  // ── Antibiotics: Carbapenems ─────────────────────────────────────────────
  "ertapenem", "imipenem-cilastatin", "meropenem", "meropenem-vaborbactam",
  "doripenem",

  // ── Antibiotics: Monobactams ─────────────────────────────────────────────
  "aztreonam",

  // ── Antibiotics: Fluoroquinolones ────────────────────────────────────────
  "ciprofloxacin", "levofloxacin", "moxifloxacin",

  // ── Antibiotics: Aminoglycosides ─────────────────────────────────────────
  "amikacin", "gentamicin", "tobramycin",

  // ── Antibiotics: Glycopeptides ───────────────────────────────────────────
  "vancomycin", "oritavancin", "dalbavancin", "telavancin",

  // ── Antibiotics: Lipopeptides ────────────────────────────────────────────
  "daptomycin",

  // ── Antibiotics: Oxazolidinones ──────────────────────────────────────────
  "linezolid",

  // ── Antibiotics: Tetracyclines ───────────────────────────────────────────
  "doxycycline", "tigecycline", "eravacycline",

  // ── Antibiotics: Macrolides ──────────────────────────────────────────────
  "azithromycin", "erythromycin",

  // ── Antibiotics: Miscellaneous ───────────────────────────────────────────
  "clindamycin", "metronidazole", "trimethoprim-sulfamethoxazole",
  "colistin", "polymyxin B", "chloramphenicol", "fosfomycin",
  "rifampin", "isoniazid",

  // ── Antifungals ──────────────────────────────────────────────────────────
  "amphotericin B", "amphotericin B liposomal", "anidulafungin",
  "caspofungin", "micafungin", "fluconazole", "itraconazole",
  "voriconazole", "posaconazole", "isavuconazonium",

  // ── Antivirals ───────────────────────────────────────────────────────────
  "acyclovir", "ganciclovir", "valganciclovir", "foscarnet", "cidofovir",
  "oseltamivir", "peramivir", "remdesivir",

  // ── Antiparasitics ───────────────────────────────────────────────────────
  "artesunate", "quinidine gluconate",

  // ── Anticoagulants ───────────────────────────────────────────────────────
  "heparin", "bivalirudin", "argatroban", "fondaparinux",
  "enoxaparin", "lepirudin",

  // ── Thrombolytics ────────────────────────────────────────────────────────
  "alteplase", "tenecteplase", "reteplase",

  // ── Antiplatelets ────────────────────────────────────────────────────────
  "eptifibatide", "tirofiban", "abciximab", "cangrelor",

  // ── Cardiovascular: Antiarrhythmics ──────────────────────────────────────
  "amiodarone", "lidocaine", "procainamide", "adenosine",
  "ibutilide", "flecainide", "sotalol",

  // ── Cardiovascular: Vasopressors / Inotropes ─────────────────────────────
  "dopamine", "dobutamine", "epinephrine", "norepinephrine",
  "phenylephrine", "vasopressin", "milrinone", "isoproterenol",

  // ── Cardiovascular: Vasodilators ─────────────────────────────────────────
  "nitroglycerin", "nitroprusside", "hydralazine", "nicardipine",
  "clevidipine", "esmolol", "labetalol",

  // ── Cardiovascular: Antihypertensives ────────────────────────────────────
  "enalaprilat", "phentolamine",

  // ── Cardiovascular: Diuretics ────────────────────────────────────────────
  "furosemide", "bumetanide", "torsemide", "ethacrynic acid",
  "mannitol", "acetazolamide",

  // ── Cardiovascular: Other ────────────────────────────────────────────────
  "digoxin", "atropine", "calcium chloride", "calcium gluconate",

  // ── CNS: Sedatives / Anesthetics ─────────────────────────────────────────
  "propofol", "dexmedetomidine", "ketamine", "etomidate",
  "midazolam", "lorazepam", "diazepam",

  // ── CNS: Opioids ─────────────────────────────────────────────────────────
  "morphine", "hydromorphone", "fentanyl", "sufentanil",
  "remifentanil", "methadone", "naloxone", "buprenorphine",

  // ── CNS: Neuromuscular Blockers ───────────────────────────────────────────
  "succinylcholine", "rocuronium", "vecuronium", "cisatracurium",
  "atracurium", "pancuronium", "neostigmine", "sugammadex",

  // ── CNS: Antiepileptics ───────────────────────────────────────────────────
  "phenytoin", "fosphenytoin", "levetiracetam", "valproate",
  "lacosamide", "phenobarbital", "brivaracetam",

  // ── CNS: Antipsychotics ───────────────────────────────────────────────────
  "haloperidol", "olanzapine", "ziprasidone", "droperidol",

  // ── CNS: Reversal Agents ──────────────────────────────────────────────────
  "flumazenil", "physostigmine",

  // ── Analgesics / Anti-inflammatory ───────────────────────────────────────
  "ketorolac", "ibuprofen", "acetaminophen", "dexamethasone",
  "methylprednisolone", "hydrocortisone",

  // ── GI Agents ────────────────────────────────────────────────────────────
  "omeprazole", "pantoprazole", "esomeprazole", "famotidine",
  "ranitidine", "metoclopramide", "ondansetron", "granisetron",
  "dolasetron", "palonosetron", "prochlorperazine", "promethazine",
  "octreotide", "vasopressin",

  // ── Pulmonary ─────────────────────────────────────────────────────────────
  "aminophylline", "theophylline", "epoprostenol", "treprostinil",
  "iloprost", "sildenafil", "bosentan",

  // ── Endocrine / Metabolic ─────────────────────────────────────────────────
  "insulin regular", "glucagon", "dextrose 50%", "sodium bicarbonate",
  "potassium chloride", "potassium phosphate", "magnesium sulfate",
  "sodium phosphate", "zinc chloride",

  // ── Oncology: Alkylating Agents ───────────────────────────────────────────
  "cyclophosphamide", "ifosfamide", "melphalan", "busulfan",
  "carmustine", "lomustine", "dacarbazine", "temozolomide",
  "bendamustine", "thiotepa", "oxaliplatin", "carboplatin", "cisplatin",

  // ── Oncology: Antimetabolites ─────────────────────────────────────────────
  "methotrexate", "fluorouracil", "cytarabine", "gemcitabine",
  "cladribine", "fludarabine", "clofarabine", "pemetrexed",
  "pralatrexate", "azacitidine", "decitabine",

  // ── Oncology: Anthracyclines ──────────────────────────────────────────────
  "doxorubicin", "doxorubicin liposomal", "daunorubicin",
  "epirubicin", "idarubicin", "mitoxantrone",

  // ── Oncology: Topoisomerase Inhibitors ────────────────────────────────────
  "etoposide", "irinotecan", "topotecan",

  // ── Oncology: Vinca Alkaloids ─────────────────────────────────────────────
  "vincristine", "vinblastine", "vinorelbine",

  // ── Oncology: Taxanes ─────────────────────────────────────────────────────
  "paclitaxel", "docetaxel", "cabazitaxel", "nab-paclitaxel",

  // ── Oncology: Targeted Therapy ────────────────────────────────────────────
  "rituximab", "trastuzumab", "bevacizumab", "cetuximab",
  "panitumumab", "pertuzumab", "nivolumab", "pembrolizumab",
  "ipilimumab", "atezolizumab", "durvalumab", "avelumab",
  "bortezomib", "carfilzomib", "daratumumab", "elotuzumab",
  "inotuzumab ozogamicin", "gemtuzumab ozogamicin",
  "brentuximab vedotin", "polatuzumab vedotin",
  "ado-trastuzumab emtansine", "fam-trastuzumab deruxtecan",
  "ramucirumab", "necitumumab", "olaratumab",
  "obinutuzumab", "ofatumumab", "alemtuzumab",
  "mogamulizumab", "isatuximab",

  // ── Oncology: Miscellaneous ───────────────────────────────────────────────
  "bleomycin", "mitomycin", "asparaginase", "pegaspargase",
  "leucovorin", "zoledronic acid", "pamidronate", "ibandronate",
  "rasburicase", "mesna",

  // ── Immunosuppressants ────────────────────────────────────────────────────
  "cyclosporine", "tacrolimus", "mycophenolate mofetil",
  "basiliximab", "antithymocyte globulin", "belimumab",
  "infliximab", "adalimumab", "etanercept",
  "tocilizumab", "siltuximab", "anakinra", "canakinumab",
  "eculizumab", "ravulizumab",

  // ── Hematology ────────────────────────────────────────────────────────────
  "filgrastim", "pegfilgrastim", "sargramostim",
  "epoetin alfa", "darbepoetin", "eltrombopag",
  "romiplostim", "oprelvekin",
  "factor VIII", "factor IX", "fresh frozen plasma",
  "albumin", "immune globulin intravenous",
  "antihemophilic factor", "von Willebrand factor",
  "prothrombin complex concentrate", "cryoprecipitate",
  "phytonadione",

  // ── Renal / Fluids ────────────────────────────────────────────────────────
  "sodium chloride 0.9%", "lactated ringers", "dextrose 5%",
  "sodium chloride 0.45%", "sterile water for injection",
  "hetastarch", "albumin 5%", "albumin 25%",

  // ── Contrast / Diagnostic ─────────────────────────────────────────────────
  "iohexol", "ioversol", "iodixanol",

  // ── Antidotes / Reversal ──────────────────────────────────────────────────
  "protamine sulfate", "idarucizumab", "andexanet alfa",
  "pralidoxime", "atropine", "hydroxocobalamin", "sodium thiosulfate",
  "fomepizole", "n-acetylcysteine", "deferoxamine",
  "glucarpidase", "uridine triacetate",

  // ── Vitamins / Nutritional ────────────────────────────────────────────────
  "thiamine", "folic acid", "multivitamin infusion",
  "fat emulsion", "amino acids", "dextrose 70%",
  "ascorbic acid", "pyridoxine", "cyanocobalamin",

  // ── Hormones ──────────────────────────────────────────────────────────────
  "oxytocin", "vasopressin", "somatostatin",
  "calcitonin", "parathyroid hormone",
  "testosterone", "estradiol",

  // ── Miscellaneous ─────────────────────────────────────────────────────────
  "sodium acetate", "potassium acetate",
  "ferric carboxymaltose", "ferumoxytol", "iron sucrose",
  "sodium ferric gluconate", "low molecular weight dextran",
  "indomethacin", "zoledronic acid",
  "methylene blue", "indocyanine green",
  "papaverine", "phentolamine",
  "aminocaproic acid", "tranexamic acid",
  "urokinase", "streptokinase",

  // ── Additional Antibiotics ────────────────────────────────────────────────
  "cefiderocol", "imipenem-cilastatin-relebactam", "aztreonam-avibactam",
  "omadacycline", "delafloxacin", "tedizolid",
  "oritavancin", "iclaprim", "ceftobiprole",
  "quinupristin-dalfopristin", "minocycline",
  "gentamicin", "streptomycin", "kanamycin",
  "spectinomycin", "neomycin",
  "cefoperazone", "cefotetan", "ceftizoxime",
  "cephalothin", "cephapirin",

  // ── Additional Antivirals ─────────────────────────────────────────────────
  "ribavirin", "zanamivir", "amantadine",
  "cytomegalovirus immune globulin",

  // ── Additional Cardiovascular ─────────────────────────────────────────────
  "inamrinone", "levosimendan", "digoxin immune fab",
  "adenosine", "verapamil", "diltiazem",
  "metoprolol", "propranolol", "atenolol",
  "captopril", "lisinopril",
  "nesiritide", "terlipressin",
  "phenoxybenzamine",
  "sodium nitroprusside",

  // ── Additional CNS ────────────────────────────────────────────────────────
  "thiopental", "methohexital", "pentobarbital",
  "dexamethasone", "betamethasone",
  "ziconotide", "intrathecal baclofen",
  "cyproheptadine",
  "clonazepam", "clobazam",
  "gabapentin", "pregabalin",
  "carbamazepine", "oxcarbazepine",
  "rufinamide", "perampanel",
  "cenobamate",

  // ── Additional Oncology ───────────────────────────────────────────────────
  "tretinoin", "arsenic trioxide",
  "azacitidine", "venetoclax",
  "idelalisib", "duvelisib",
  "ruxolitinib", "fedratinib",
  "acalabrutinib", "ibrutinib",
  "palbociclib", "ribociclib",
  "olaparib", "niraparib",
  "selinexor", "gilteritinib",
  "enasidenib", "olutasidenib",
  "tagraxofusp", "olutasidenib",
  "tisagenlecleucel", "axicabtagene ciloleucel",
  "lisocabtagene maraleucel",
  "idecabtagene vicleucel",
  "ciltacabtagene autoleucel",
  "loncastuximab tesirine",
  "tafasitamab",
  "luspatercept", "imetelstat",
  "pralsetinib", "selpercatinib",
  "capmatinib", "tepotinib",
  "entrectinib", "larotrectinib",
  "sotorasib", "adagrasib",
  "amivantamab",

  // ── Additional Immunology / Biologics ─────────────────────────────────────
  "natalizumab", "vedolizumab", "ustekinumab",
  "secukinumab", "ixekizumab",
  "guselkumab", "risankizumab",
  "dupilumab", "benralizumab",
  "mepolizumab", "reslizumab",
  "omalizumab",
  "abatacept", "golimumab",
  "certolizumab", "sarilumab",
  "emapalumab", "ixekizumab",
  "crizanlizumab", "voxelotor",

  // ── Additional Hematology ─────────────────────────────────────────────────
  "eptacog alfa", "susoctocog alfa",
  "fitusiran", "emicizumab",
  "avatrombopag", "fostamatinib",
  "luspatercept",

  // ── Additional GI / Hepatic ───────────────────────────────────────────────
  "vasopressin", "terlipressin",
  "ursodiol", "chenodiol",
  "obeticholic acid",

  // ── Additional Pulmonary ──────────────────────────────────────────────────
  "alprostadil", "inhaled nitric oxide",
  "beractant", "calfactant", "poractant alfa",
  "caffeine citrate",

  // ── Additional Endocrine ──────────────────────────────────────────────────
  "cosyntropin", "protirelin",
  "gonadotropin releasing hormone", "leuprolide",
  "octreotide", "lanreotide",
  "cinacalcet", "etelcalcetide",
  "burosumab",

  // ── Additional Renal ──────────────────────────────────────────────────────
  "tolvaptan", "conivaptan",
  "lanthanum carbonate",

  // ── Additional Antidotes ──────────────────────────────────────────────────
  "digoxin immune fab", "crofab",
  "anavip", "anascorp",
  "botulism antitoxin",
  "obiltoxaximab",

  // ── Bone / Metabolic ──────────────────────────────────────────────────────
  "denosumab", "romosozumab",
  "teriparatide", "abaloparatide",
  "cinacalcet",

  // ── Ophthalmic IV ─────────────────────────────────────────────────────────
  "ranibizumab", "bevacizumab", "aflibercept",
  "brolucizumab",

  // ── Neurological ─────────────────────────────────────────────────────────
  "edaravone", "nusinersen",
  "onasemnogene abeparvovec",
  "cerliponase alfa",
  "aducanumab", "lecanemab",
  "donanemab",

  // ── Infectious Disease: Other ─────────────────────────────────────────────
  "bezlotoxumab", "obiltoxaximab",
  "raxibacumab", "palivizumab",
  "ceftolozane", "delafloxacin",
];
