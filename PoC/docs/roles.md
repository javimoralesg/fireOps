# Roles de usuario en Atalaya

Atalaya no se inventa su organigrama: reproduce el de la **protección civil española**, para que un ayuntamiento reconozca sus propios puestos nada más entrar. La fuente de verdad en código es `lib/roles.ts`.

## Base normativa

- **Ley 17/2015** del Sistema Nacional de Protección Civil: derecho de la ciudadanía a la información, deber de colaboración y voluntariado.
- **RD 524/2023, Norma Básica de Protección Civil**: principio de **dirección única** y **situaciones operativas** — 0 (servicios ordinarios), 1 (medios de la administración que dirige), 2 (máximo nivel autonómico; puede pedir medios de otras administraciones) y 3 (emergencia de interés nacional, la declara el Ministerio del Interior).
- **PEMAM** (Plan Territorial de Emergencia Municipal del Ayuntamiento de Madrid, 2023): Dirección del Plan, Comité Asesor, Gabinete de Información, CECOP y Puesto de Mando Avanzado.
- **Reglamento UE 2024/1689 (IA), art. 14**: supervisión humana de sistemas de IA de alto riesgo. Justifica el rol de supervisión de la IA.

## Roles

| Rol | En la administración real | Qué hace en Atalaya | Decide hasta riesgo |
|---|---|---|---|
| **Ciudadanía** | Población afectada | Portal público: avisos oficiales, noticias verificadas, bulos desmentidos, qué hacer, voluntariado | — |
| **Dirección del Plan** | Alcalde/sa (sit. 0–1) · consejero/a (sit. 2) | Firma lo más grave, fija la autonomía de la IA, eleva la situación, autoriza ES-Alert | 100 |
| **Dirección Técnica** | Jefatura de Emergencias (Bomberos, SAMUR-PC, Policía Municipal) | Respuesta operativa; enseña a la IA con doctrina | 70 |
| **Jefatura del PMA** | Mando en el lugar del suceso | Confirma sobre el terreno, aprueba acciones tácticas | 40 |
| **Jefatura de Sala 112** | Supervisión de sala del CECOP / 112 | Valida la ingesta, frena bulos, aprueba comunicaciones internas | 25 |
| **Operación 112** | Operador/a de sala | Clasifica la entrada, marca y escala | — |
| **Gabinete de Información** | Portavocía municipal | Redacta y publica avisos; desmiente bulos | — |
| **Comité Asesor · Supervisión IA** | Comité Asesor del plan + responsable de supervisión de la IA | **Cuestiona a los agentes**: por qué, con qué datos, con qué reglas. Audita, no ejecuta | — |
| **Coordinación de Voluntariado** | Agrupación de Voluntarios de Protección Civil | Tareas de bajo riesgo con cupo | — |
| **Enlace Delegación del Gobierno** | Delegación del Gobierno (UME, medios estatales) | Observa para anticipar la escalada a situación 2–3 | — |
| **Administración** | Servicio TIC | Organismo, usuarios, conectores y simulacros. No decide | — |

## Principios

1. **Quien no puede decidir, escala.** Si una propuesta supera tu riesgo máximo, el botón pasa a ser *Escalar a Dirección Técnica / del Plan* (`escalarA(riesgo)`). Siempre hay un humano con autoridad al final de la cadena.
2. **Una sola voz hacia fuera.** Solo el Gabinete publica en el portal ciudadano, y la difusión masiva (ES-Alert) exige además la firma de la Dirección del Plan.
3. **La IA se puede interrogar.** Todo rol con `interrogar_ia` puede preguntar por qué se propone algo. El Comité Asesor ve además las trazas completas: modelo, evidencia y reglas de doctrina.
4. **La ciudadanía solo ve lo verificado.** Ni eventos sin verificar ni decisiones pendientes: solo avisos publicados y bulos desmentidos.

## Superficies

| Ruta | Para | Dueño |
|---|---|---|
| `/acceso` | Elegir perfil (demo sin credenciales; en producción, Cl@ve / certificado) | poc-18 |
| `/` | Consola de mando, que se adapta al rol | poc-26 |
| `/auditoria` | Interrogar a los agentes y revisar sus trazas | poc-18 |
| `/ciudadano` | Portal público en tiempo real | poc-18 |
| `/politica` | Definir qué gestiona la IA sola, qué firma una persona y qué queda reservado (matriz de competencias + umbral). Edita solo quien tiene `fijar_umbral` (Dirección del Plan); el resto del personal la consulta | poc-c5 |
| `/periferico` | Móvil de ciudadanía o jurado: emparejar por QR y enviar foto, voz o ubicación | poc-07 |
| `/perifericos` | Sala de periféricos: dispositivos, cámaras de tráfico y publicaciones (Administración y Sala 112) | poc-07 |
