// Imágenes del dataset: todas de Wikimedia Commons con licencia libre (créditos en
// public/dataset/img/CREDITOS.md). Redimensionadas a 1024 px de ancho como máximo.
//
// OJO: ninguna foto es del suceso simulado. Las de eventos "real" son ilustrativas;
// las de los bulos son de un suceso ANTERIOR y distinto, y su origen real (según los
// metadatos de Commons) está en el motivoBulo del evento que la usa.

import type { ImagenDataset } from "./tipos";

export const IMAGENES = {
  humoNave: {
    archivo: "/dataset/img/humo-nave-west-footscray-2018.jpg",
    descripcion: "Columna de humo negro muy denso sobre una zona industrial al atardecer (recortada). Ilustrativa: es el incendio de un almacén en West Footscray (Victoria, Australia), agosto de 2018.",
    licencia: "CC BY 4.0",
    autor: "Environment Protection Authority Victoria",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Smoke_2018_Warehouse_fire_in_West_Footscray.jpg",
  },
  explosionBuncefield: {
    archivo: "/dataset/img/explosion-buncefield-2005.jpg",
    descripcion: "Nube de humo gigantesca sobre una autopista iluminada al amanecer. Explosión del depósito de combustible de Buncefield (Hemel Hempstead, Reino Unido), 11 de diciembre de 2005, vista desde la autopista M1.",
    licencia: "CC BY-SA 3.0",
    autor: "Robert Stainforth",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Buncefield_explosion_from_M1_motorway.jpg",
  },
  humoEdificioLondonCanada: {
    archivo: "/dataset/img/humo-edificio-viviendas-2016.jpg",
    descripcion: "Humo saliendo de un bloque de viviendas con un vehículo de mando de bomberos en primer plano (rotulado 'Command No. 2 – Fire', 'Londoners'). Incendio en London (Ontario, Canadá), 9 de julio de 2016.",
    licencia: "CC BY-SA 2.0",
    autor: "WabbitWanderer (London, Canadá)",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Fire_(28173293816).jpg",
  },
  forestalPonteSampaio: {
    archivo: "/dataset/img/incendio-forestal-ponte-sampaio-2016.jpg",
    descripcion: "Tres aviones anfibios de extinción sobrevolando un monte arbolado bajo un cielo cargado de humo. Incendio forestal de Ponte Sampaio (Pontevedra, Galicia), 10 de agosto de 2016.",
    licencia: "CC BY-SA 2.0",
    autor: "Contando Estrelas (Vigo)",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Incendio_forestal_en_Ponte_Sampaio_(28797468332).jpg",
  },
  pasoInferiorInundado: {
    archivo: "/dataset/img/paso-inferior-inundado-hengrove-2021.jpg",
    descripcion: "Paso inferior peatonal anegado de agua turbia con basura flotando. Ilustrativa: Hengrove (Bristol, Reino Unido), diciembre de 2021.",
    licencia: "CC BY-SA 2.0",
    autor: "Nigel Mykura (geograph.org.uk)",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Flooded_Underpass_at_Hengrove_-_geograph.org.uk_-_7053272.jpg",
  },
  danaValencia2024: {
    archivo: "/dataset/img/dana-valencia-2024-vias-metro.jpg",
    descripcion: "Vías de metro arrancadas y cubiertas de cañas y escombros sobre un barranco con agua marrón. DANA de octubre de 2024: vías de Metrovalencia entre Picanya y Paiporta (Valencia), 30-10-2024.",
    licencia: "CC0",
    autor: "Enkantari",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:DANA_OCTUBRE_2024_al_Pa%C3%ADs_Valenci%C3%A0_-_Vies_del_Metro_entre_Picanya_i_Paiporta.png",
  },
  atascoA3Limburg: {
    archivo: "/dataset/img/accidente-autopista-a3-2014.jpg",
    descripcion: "Retención kilométrica en una autopista cortada por un accidente, con grúa al fondo y cartel azul 'Limburg 5 km'. Autopista A3 (Limburg an der Lahn, Alemania), 7 de septiembre de 2014.",
    licencia: "CC BY-SA 4.0",
    autor: "Raimond Spekking",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Verkehrsunfall_A3_zwischen_Limburg_und_Bad_Camberg-0268.jpg",
  },
  nieveCibelesFilomena: {
    archivo: "/dataset/img/nieve-cibeles-filomena-2021.jpg",
    descripcion: "Plaza de Cibeles cubierta por una gruesa capa de nieve. Borrasca Filomena, Madrid, 9 de enero de 2021.",
    licencia: "CC BY-SA 4.0",
    autor: "Benjamín Núñez González",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Cibeles_con_nieve,_Madrid,_Espa%C3%B1a,_2021_05.jpg",
  },
  multitudSol2011: {
    archivo: "/dataset/img/aglomeracion-sol-2011.jpg",
    descripcion: "Puerta del Sol abarrotada, con carteles de protesta ('Sin casa, sin futuro, sin miedo') y lonas de acampada. Acampada del 15M, Madrid, 22 de mayo de 2011.",
    licencia: "CC BY-SA 3.0",
    autor: "NeilK",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Protests_in_Puerta_del_Sol,_Madrid_-_crowd_1.jpg",
  },
  derrumbeHurlstone: {
    archivo: "/dataset/img/derrumbe-hurlstone-park-2020.jpg",
    descripcion: "Bomberos buscando entre los escombros de ladrillo de un edificio parcialmente derrumbado con andamio. Ilustrativa: Hurlstone Park (Sídney, Australia), febrero de 2020.",
    licencia: "CC BY-SA 4.0",
    autor: "Helitak430",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:FRNSW_Building_Collapse.jpg",
  },
  derrumbeSurfside: {
    archivo: "/dataset/img/derrumbe-surfside-2021.jpg",
    descripcion: "Bomberos sobre una montaña de escombros de un bloque de pisos de gran altura. Derrumbe de las Champlain Towers South (Surfside, Florida, EE. UU.), 24 de junio de 2021.",
    licencia: "Dominio público",
    autor: "Miami-Dade Fire Rescue Department",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Surfside_condominium_collapse_photo_from_Miami-Dade_Fire_Rescue_3.jpg",
  },
  descarrilamientoMontparnasse: {
    archivo: "/dataset/img/descarrilamiento-montparnasse-1895.jpg",
    descripcion: "Locomotora de vapor que ha atravesado la fachada de una estación y cuelga sobre la calle. Accidente de la estación de Montparnasse (París), 22 de octubre de 1895. Fotografía en blanco y negro.",
    licencia: "Dominio público",
    autor: "Studio Lévy & fils (atribuida)",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Train_wreck_at_Montparnasse_1895.jpg",
  },
  apagonChamartin2025: {
    archivo: "/dataset/img/apagon-chamartin-2025.jpg",
    descripcion: "Vestíbulo de la estación de Chamartín lleno de viajeros esperando sin servicio. Apagón peninsular del 28 de abril de 2025.",
    licencia: "CC BY-SA 4.0",
    autor: "Rastrojo",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Apag%C3%B3n_de_2025_en_Madrid_-_viajeros_en_Madrid-Chamart%C3%ADn.jpg",
  },
  termometroVitoria2022: {
    archivo: "/dataset/img/termometro-42-vitoria-2022.jpg",
    descripcion: "Cruz de farmacia luminosa marcando +42 °C (recortada para no mostrar rótulos con nombres). Farmacia de la calle Diputación, Vitoria-Gasteiz, ola de calor del 18 de julio de 2022.",
    licencia: "CC BY-SA 4.0",
    autor: "Centenoyespelta",
    urlOrigen: "https://commons.wikimedia.org/wiki/File:Termometro_42_grados.jpg",
  },
} satisfies Record<string, ImagenDataset>;
