# Si bëhet editimi i videove: mjetet, procedurat dhe kontrolli i cilësisë

Ky dokument shpjegon në mënyrë të përgjithshme si planifikohet, përpunohet dhe verifikohet montimi i videos me mjete softuerike. Nuk përshkruan një montim të caktuar dhe nuk i referohet ndonjë videoje konkrete.

## 1. Çfarë nënkupton editimi i videos

Një skedar video përmban një rrjedhë kuadrosh të renditur sipas kohës dhe, zakonisht, një ose disa rrjedha audioje. Montimi është procesi i zgjedhjes dhe organizimit të këtyre rrjedhave: vendosja e pikës ku fillon e mbaron një segment, radhitja e pamjeve, përpunimi i figurës, sinkronizimi i zërit, vendosja e titrave dhe eksportimi i rezultatit në një format të përdorshëm.

Kur përdoret një sistem me inteligjencë artificiale, detyra ndahet në dy pjesë:

1. **Kuptimi dhe planifikimi:** interpretohet kërkesa, analizohen materialet dhe përcaktohen momentet që duhen përdorur.
2. **Përpunimi mediatik:** zbatohen prerjet, filtrat, përzierja e audios dhe kodimi i daljes.

Inteligjenca artificiale mund të ndihmojë në analizën e përmbajtjes ose në gjetjen e pikave kohore, por rezultati final përsëri duhet të përpunohet dhe kontrollohet si skedar video.

## 2. Mjetet kryesore

### FFmpeg

**FFmpeg** është një paketë mjetesh për leximin, përpunimin dhe kodimin e videos dhe audios. Mund të përdoret për:

- prerje dhe bashkim segmentesh;
- ndryshim përmasash dhe orientimi;
- rregullim të ndriçimit, kontrastit, ngjyrave dhe mprehtësisë;
- vendosje titrash ose teksti të përgatitur;
- heqje, ulje, rritje ose përzierje të audios;
- nxjerrje të kuadrove, audios ose sekuencave të shkurtra;
- kodim në formate si MP4/H.264 dhe AAC.

FFmpeg mund të punojë pa ndërfaqe grafike. Udhëzimet i jepen përmes parametrave dhe filtrave. Përpunimi mund të jetë një hap i vetëm ose një zinxhir hapash ku dalja e një filtri i kalon të dhënat filtrit pasues.

### FFprobe

**FFprobe** lexon karakteristikat teknike të një skedari pa e montuar atë. Përdoret për të kontrolluar:

- kohëzgjatjen;
- gjerësinë dhe lartësinë e figurës;
- shpejtësinë e kuadrove;
- kodekun e videos dhe të audios;
- numrin e kanaleve audio dhe frekuencën e mostrimit;
- rrjedhat, metadatat dhe kohëzgjatjet e tyre.

Këto të dhëna janë të rëndësishme sepse dy video që duken njësoj mund të kenë parametra të ndryshëm dhe të mos bashkohen pa u normalizuar.

### Mjete transkriptimi

Një mjet i të folurës në tekst prodhon transkript ose pjesë teksti të shoqëruara me kohë. Transkripti mund të përdoret për të gjetur një fjalë, fjali ose temë dhe për të përgatitur titra. Ai nuk është gjithmonë i saktë: emrat, dialektet, zhurma në sfond dhe të folurit e shpejtë mund të shkaktojnë gabime. Prandaj transkripti duhet krahasuar me audion, veçanërisht kur teksti do të shfaqet si titër.

### Mjete të analizës së videos

Mjetet multimodale mund të përmbledhin skena, të dallojnë lloje veprimesh ose të sugjerojnë intervale kohore. Ato janë të dobishme për kërkim në materiale të gjata, por mund të gabojnë në identifikimin e personave, në përshkrimin e skenës ose në saktësinë e kohëve. Ato shërbejnë si ndihmë për orientim; nuk zëvendësojnë kontrollin e kuadrove dhe dëgjimin e audios.

### Python dhe mjete ndihmëse

Python mund të përdoret për automatizimin e punëve të përsëritura, si inventarizimi i skedarëve, përgatitja e fletëve të kontaktit, krijimi i listave të prerjeve ose gjenerimi i skedarëve të titrave. Për ndryshime të thjeshta dhe të përcaktuara në piksel mund të përdoren biblioteka imazhi. Për kodim video dhe audio, zakonisht FFmpeg mbetet mjeti kryesor.

## 3. Rrjedha e punës nga fillimi në fund

### Hapi 1: Përcaktimi i kërkesës

Para përpunimit sqarohet çfarë duhet të përmbajë rezultati:

- qëllimi dhe audienca e videos;
- skedarët burimorë dhe roli i secilit;
- sekuenca e pamjeve;
- segmentet që duhet të hiqen ose të përfshihen;
- nëse zëri origjinal ruhet;
- nëse shtohen muzikë, titra, logo ose fotografi;
- orientimi dhe përmasat e daljes;
- kohëzgjatja e përafërt dhe cilësia e synuar.

Kur mungojnë hollësi, bëhet një zgjedhje e arsyeshme vetëm nëse nuk ndryshon kuptimin ose përmbajtjen e kërkuar. Përndryshe, paqartësia zgjidhet përpara se të ndërmerret veprimi që do të ndikonte dukshëm te rezultati.

### Hapi 2: Organizimi dhe mbrojtja e burimeve

Skedarët burimorë inventarizohen dhe organizohen në një dosje pune. Rekomandohet:

- të ruhen origjinalet pa i mbishkruar;
- të dallohen qartë videot, fotot, muzika, transkriptet dhe eksportet;
- të emërtohen versionet me emra të kuptueshëm;
- të mbahet shënim se cilat burime dhe intervale kohore janë përdorur.

Nëse materiali vjen brenda një arkivi, fillimisht verifikohet përmbajtja e arkivit dhe pastaj hapen skedarët për përpunim.

### Hapi 3: Kontrolli teknik i burimeve

Me FFprobe kontrollohen rezolucioni, kohëzgjatja, shpejtësia e kuadrove, kodekët dhe prania e audios. Në këtë fazë vërehen edhe mospërputhjet, si:

- një video vertikale dhe një tjetër horizontale;
- shpejtësi të ndryshme kuadrosh;
- kohëzgjatje ose numër kanalesh audio të ndryshëm;
- video pa audio ose me audio të shkëputur nga figura;
- orientim i ruajtur vetëm në metadate, jo në vetë kuadrot.

Nëse formati i burimeve ndryshon, vendoset çfarë duhet normalizuar përpara bashkimit. Normalizimi mund të përfshijë rezolucionin, shpejtësinë e kuadrove, raportin e pikselit, formatin e ngjyrave ose parametrat audio.

### Hapi 4: Gjetja e pikave kohore

Për kërkesa që varen nga fjalët, transkriptohet audioja dhe kërkohen fjalët ose fjalitë përkatëse. Për kërkesa që varen nga veprimet, analizohen skena të shkurtra ose nxirren kuadro në intervale të caktuara.

Për një prerje të pastër, zakonisht duhen dy pika:

- **hyrja**, kur fillon veprimi ose fjalia e rëndësishme;
- **dalja**, kur përfundon veprimi ose fjalia, duke lënë hapësirë të mjaftueshme për kuptim dhe ritëm.

Pikat automatike janë vetëm propozime. Ato kontrollohen me kuadro para dhe pas kufirit të prerjes, si dhe me dëgjim të audios për të shmangur ndërprerjen e fjalëve.

### Hapi 5: Hartimi i vijës kohore

Përpara eksportit ndërtohet një plan i sekuencës. Për secilin segment shënohen:

- skedari burimor;
- pika e fillimit dhe mbarimit në atë skedar;
- vendi ku do të shfaqet në daljen përfundimtare;
- nëse përdoret audioja e segmentit;
- nëse segmenti ka efekt, titër ose tranzicion.

Ky plan ndihmon që prerjet të jenë të përsëritshme dhe që ndryshimet e mëvonshme të mos prishin sinkronizimin.

## 4. Prerja dhe bashkimi i klipeve

Një prerje përcakton intervalin e kuadrove që ruhet. Për prerje pa rikodim mund të kopjohen rrjedhat drejtpërdrejt, por pika e prerjes mund të kufizohet nga pikat kyçe të kodimit. Për prerje të sakta në kuadër, shpesh kërkohet rikodim.

Kur bashkohen disa skedarë, formatet duhet të jenë të pajtueshme ose të konvertohen në parametra të njëjtë. Në të kundërt mund të shfaqen:

- kërcime në figurë ose në ritëm;
- humbje sinkronizimi;
- diferenca në ngjyrë ose përmasa;
- mungesë zëri pas bashkimit.

Një tranzicion nuk është gjithmonë i nevojshëm. Prerja e drejtë shpesh është më e qartë; tranzicionet përdoren vetëm kur i shërbejnë ritmit ose kuptimit.

## 5. Rregullimi i pamjes

### Ndriçimi dhe ekspozimi

Ndriçimi mund të rritet duke shtuar vlerë në shkëlqimin e kuadrove ose duke rregulluar ekspozimin, hijet dhe tonet e mesme. Këto veprime nuk janë identike:

- **Shkëlqimi (brightness)** zhvendos përgjithësisht nivelet e dritës së figurës;
- **ekspozimi** ndikon në ndriçimin e përgjithshëm në mënyrë të ngjashme me kontrollin e ekspozimit të kamerës;
- **hijet dhe tonet e mesme** lejojnë të ndriçohen pjesët e errëta pa i zbardhur njësoj zonat tashmë të çelëta;
- **kontrasti** rrit ose zvogëlon dallimin mes zonave të errëta dhe të ndritshme.

Rritja e tepërt mund të humbasë hollësitë në fytyra, dritare, qiell ose burime të tjera drite. Prandaj kontrollohen kuadro nga disa pjesë të videos, jo vetëm një kuadër.

### Ngjyra dhe balanca e të bardhës

Balanca e të bardhës korrigjon nuancat e padëshiruara, si pamja shumë e kaltër ose shumë e verdhë. Ngopja kontrollon intensitetin e ngjyrave. Korrigjimi duhet të jetë i qëndrueshëm ndërmjet segmenteve që shfaqen njëri pas tjetrit, përndryshe montimi mund të duket sikur ndryshon kamera ose ambienti.

### Mprehtësia dhe zhurma

Mprehja mund të theksojë konturet, por nuk rikthen hollësi që nuk janë regjistruar. Reduktimi i zhurmës mund të zbusë kokrrizimin, por nëse teprohet krijon pamje plastike ose heq teksturën. Këto efekte duhen përdorur me kujdes dhe vlerësuar në madhësinë ku do të shihet videoja.

## 6. Përshtatja e raportit të pamjes

Raporti i pamjes përcakton lidhjen mes gjerësisë dhe lartësisë. Formatet e zakonshme përfshijnë horizontal, vertikal dhe katror. Kur burimi dhe dalja kanë raporte të ndryshme, ekzistojnë tri zgjidhje kryesore:

1. **Prerje (crop):** mbushet i gjithë kuadri, por mund të humbasin pjesët anësore ose sipër/poshtë.
2. **Shirita bosh (pad):** ruhet i gjithë kuadri dhe hapësira e mbetur mbushet me ngjyrë ose grafikë.
3. **Sfond i turbulluar:** kopja e zmadhuar e videos përdoret si sfond, ndërsa videoja e plotë vendoset përpara.

Zgjedhja varet nga ajo që duhet ruajtur. Para eksportit kontrollohet që fytyrat, duart, titrat dhe objektet kryesore të mos dalin jashtë kuadrit.

## 7. Audioja dhe miksimi

### Ruajtja ose heqja e audios

Videoja dhe audioja mund të trajtohen veçmas. Mund të ruhet zëri i një skedari ndërsa përdoret vetëm figura e një tjetri. Mund të hiqet audioja e burimit të dytë, të ulet niveli i muzikës ose të zëvendësohet plotësisht pista zanore.

Duhet vendosur nëse audioja e një segmenti të hequr duhet të hiqet bashkë me figurën, apo nëse duhet të vazhdojë audioja e videos kryesore. Kjo zgjedhje ndikon te kuptimi, rrjedhshmëria dhe kohëzgjatja.

### Nivelet dhe pastërtia e zërit

Zëri duhet të jetë i kuptueshëm dhe pa kulme që shtrembërojnë tingullin. Muzika zakonisht mbahet më poshtë se të folurit. Përzierja mund të përfshijë:

- rregullimin e volumit;
- zbehjen graduale në hyrje dhe dalje;
- heqjen e zhurmës së qëndrueshme;
- kufizimin e kulmeve;
- rregullimin e balancës mes kanaleve stereo;
- normalizimin e nivelit të përgjithshëm.

Filtrat e heqjes së zhurmës mund ta ndryshojnë timbrin e zërit. Rezultati duhet dëgjuar, jo vetëm matur me vlera numerike.

### Muzika dhe sinkronizimi

Muzika mund të shkurtohet ose të zgjatet për t’iu përshtatur kohëzgjatjes. Kur pritet në mes, kontrollohet që ndërprerja të mos jetë e beftë ose jashtë ritmit. Nëse ka të folur, muzika nuk duhet ta mbulojë atë. Në fund kontrollohet i gjithë miksimi me kufje ose altoparlantë.

## 8. Titra dhe tekst në ekran

### Përgatitja e titrave

Titra të mira janë të sakta, të lexueshme dhe të sinkronizuara. Teksti ndahet në segmente kuptimore dhe vendoset për kohën kur folësi thotë fjalët përkatëse. Duhet shmangur që:

- një titër të shfaqet tepër shkurt;
- shumë fjalë të grumbullohen në të njëjtin ekran;
- rreshtat të dalin jashtë kufijve të videos;
- teksti të mbulojë gojën ose informacion të rëndësishëm;
- koha e titrave të ndryshojë nga ajo e videos pas një prerjeje.

### Titrat e integruara dhe titrat e veçanta

- **Titra të integruara (burned-in):** teksti bëhet pjesë e pikselëve të videos. Shfaqet kudo, por nuk mund të fiket pa përpunuar sërish videon.
- **Skedar titrash i veçantë:** ruhet si skedar më vete, si SRT ose ASS, dhe mund të ndizet/fiket në luajtësit që e mbështesin.

Formati ASS lejon kontroll më të hollësishëm të fontit, konturit, pozicionit, madhësisë dhe stileve. Megjithatë, duhet verifikuar që fonti i nevojshëm gjendet në mjedisin ku bëhet eksporti.

## 9. Kodimi dhe eksportimi

Pas montimit, dalja kodohet në një format që mbështetet gjerësisht. Skedari përfundimtar ka një kontejner, si MP4, brenda të cilit mund të ketë video H.264 dhe audio AAC. Kontejneri është mbështjellësi; kodekët janë mënyra si kompresohen rrjedhat.

Parametrat kryesorë të eksportit janë:

- rezolucioni;
- shpejtësia e kuadrove;
- kodeku dhe profili i kodimit;
- cilësia ose niveli i kompresimit;
- shpejtësia e biteve;
- formati dhe frekuenca e mostrimit të audios.

Kompresimi me humbje ul madhësinë duke hequr një pjesë të informacionit. Për një eksport të vetëm për përdorim të zakonshëm, zgjidhet një kompromis mes madhësisë dhe cilësisë. Rikodimet e përsëritura mund ta ulin cilësinë; kur është e mundur, është më mirë të rikodohen materialet nga burimi origjinal sesa nga një eksport tashmë i kompresuar.

## 10. Kontrolli i cilësisë

Kontrolli teknik dhe ai vizual janë të dy të nevojshëm.

### Kontrolli teknik

- Skedari ekziston dhe mund të hapet.
- Kohëzgjatja është e besueshme.
- Rezolucioni, orientimi dhe shpejtësia e kuadrove janë ato të planifikuara.
- Rrjedha e audios është e pranishme dhe ka kohëzgjatjen e duhur.
- Nuk ka gabime dekodimi ose ndërprerje të papritura.

### Kontrolli i pamjes dhe zërit

- Shikohen hyrja, dalja dhe pikat pranë çdo prerjeje.
- Kontrollohen titrat në ekranet me tekstin më të gjatë.
- Verifikohet ndriçimi në pjesët e errëta dhe të çelëta.
- Dëgjohen fillimi, ndryshimet e audios dhe fundi.
- Kontrollohet sinkronizimi mes gojës, zërit dhe titrave.
- Vlerësohet nëse çdo insert ka kuptim në kontekst dhe nëse kalimi te segmenti pasues është i qartë.

Fletët e kontaktit — disa kuadro të vendosura në një pamje të vetme — ndihmojnë për krahasimin e skenave dhe gjetjen e prerjeve të gabuara. Ato nuk zëvendësojnë shikimin e videos me shpejtësi normale, sidomos kur ka lëvizje të shpejta ose sinkronizim të rëndësishëm.

## 11. Gabime të zakonshme dhe si shmangen

- **Prerje në mes të një fjale:** kontrollohen valët e audios dhe dëgjohet kufiri i prerjes.
- **Titrat dalin jashtë ekranit:** maten rreshtat në raport me përmasat reale të daljes.
- **Figura shumë e ndritshme:** kontrollohen detajet në zonat e bardha dhe fytyrat; ulet vlera e filtrit nëse ka humbje detajesh.
- **Video horizontale pritet në mënyrë të gabuar:** shihet paraprakisht ku do të bjerë prerja dhe çfarë humbet.
- **Audioja ndryshon papritur:** kontrollohen nivelet, kalimet dhe burimi i secilës rrjedhë.
- **Zëri del jashtë sinkronizimit:** krahasohen kohëzgjatjet e rrjedhave dhe përdoren pika reference të qarta.
- **Skedari përfundimtar ka kohëzgjatje të gabuar:** krahasohen kohëzgjatjet e audios dhe videos dhe kontrollohet mënyra si trajtohet fundi i secilës rrjedhë.
- **Dalja përmban vetëm pjesën e parë:** verifikohet se eksporti nuk po ndërpritet nga rrjedha më e shkurtër ose nga një limit kohor i vendosur gabimisht.

## 12. Çfarë mund dhe nuk mund të garantojë automatizimi

Automatizimi është i mirë për veprime të përcaktuara qartë dhe të përsëritshme: prerje sipas kohës, konvertim formati, rregullim ndriçimi, vendosje titrash dhe eksport. Analiza automatike mund të ndihmojë në kërkimin e një skene ose fjale, por mund të japë kohë të pasakta ose të ngatërrojë njerëz dhe veprime të ngjashme.

Për këtë arsye:

- propozimet automatike duhen verifikuar;
- emrat dhe fjalët e rëndësishme duhen kontrolluar në audio;
- identifikimi i një personi nuk duhet nxjerrë vetëm nga një përshkrim i përgjithshëm i skenës;
- një eksport teknikisht i vlefshëm nuk do të thotë automatikisht se montimi është kuptimplotë;
- kontrolli përfundimtar duhet të përfshijë si pamjen, ashtu edhe audion.

## 13. Përmbledhje e procesit

Rrjedha e zakonshme është:

1. Përcaktohet rezultati i kërkuar dhe ruhen origjinalet.
2. Kontrollohen parametrat e skedarëve me FFprobe.
3. Analizohen pamjet dhe audioja për të gjetur segmentet e duhura.
4. Shënohen pikat kohore dhe ndërtohet vija kohore.
5. Zbatohen prerjet, filtrat e figurës, rregullimet audio dhe titrat me FFmpeg.
6. Eksportohet në formatin e synuar.
7. Verifikohet kohëzgjatja, rezolucioni, audioja, titrat, kalimet dhe kuadrot kryesore.
8. Nëse kontrolli zbulon problem, korrigjohet montimi dhe eksportohet një version i ri.

Në thelb, procesi ndërthur **gjykimin editorial** — çfarë duhet të shihet dhe dëgjohet — me **përpunimin teknik** që zbaton këto vendime në nivel kuadrosh dhe mostrash audioje.