# Domiguard: página web real

Vigilante de marca para bancos y fintechs: encuentra solo los sitios que los suplantan y les entrega las alertas con evidencia para que los den de baja.

```
web/         el sitio: index.html (qué hacemos y planes) y panel.html (panel del cliente)
supabase/    schema.sql: tablas de sitios, clientes, alertas y estado
scripts/     actualizar.py (corrida diaria), detector.py (motor de detección),
             entrenar.py (reentrenar el modelo) y generar_demo.py (datos de demostración)
data/        phishing_dataset.csv (las 88,647 URLs de tu Excel) y clientes_demo.json
.github/     los dos flujos automáticos: corrida diaria y publicación de la página
```

## Cómo funciona

Domiguard busca solo los sitios que suplantan a cada cliente y se los entrega con evidencia. El cliente decide si los da de baja. Domiguard no contacta ni tumba ningún sitio.

GitHub Actions corre `scripts/actualizar.py` cada hora, al minuto 15 (incluye las 5:15 am de Mérida), y además cada 5 minutos en modo rápido (`--rapida`: solo el camino B, variantes por DNS). Nunca corren dos a la vez. El panel vuelve a leer la base cada 5 minutos. La corrida completa hace:

1. **Camino A, reportes.** Baja la lista pública de PhishHunt (dominio público, CC0) y revisa cuáles sitios nombran o imitan a un cliente.
2. **Camino B, búsqueda activa.** Para cada dominio oficial de un cliente genera variantes (letra omitida, repetida o cambiada, 1 por l, 0 por o, guiones, "seguro", "login", otras terminaciones) y pregunta por DNS cuáles ya existen. Esto encuentra sitios que ninguna lista ha reportado todavía.
3. **Evidencia.** Para cada hallazgo nuevo consulta el registro público del dominio (RDAP: fecha de registro, registrador y correo de abuso), calcula el puntaje del modelo y la prioridad (alta, media o baja).
4. **Aviso.** Manda a cada cliente un correo con sus alertas nuevas y un CSV adjunto con las direcciones completas.
5. **Seguimiento.** Revisa por DNS si los sitios de alertas abiertas siguen existiendo. No abre ningún sitio.

La página pública lee la base y muestra el panel de cada cliente. No explica de dónde salen los datos.

Cada alerta dice si **la señala un reporte externo** (camino A) o está **por revisar** (camino B: el dominio existe y se parece, pero nadie lo ha reportado). Es la diferencia entre "confirmado" y "sospechoso", y conviene mantenerla así de clara con los clientes.

## Publicarlo, paso a paso (una tarde)

### 1. Ver la página en tu computadora (2 minutos)
Abre una terminal en la carpeta `web` y ejecuta `python3 -m http.server 8000`. Entra a http://localhost:8000. Sin configurar nada, panel.html muestra datos de demostración: 6 bancos y fintechs (BBVA México primero) con 12 alertas reales, todas encontradas en la fuente pública entre el 19 y el 26 de octubre de 2026.

### 2. Crear la base de datos en Supabase
1. Crea una cuenta en supabase.com y un proyecto nuevo. Guarda la contraseña que te pida.
2. Entra a **SQL Editor**, crea una consulta nueva, pega todo el contenido de `supabase/schema.sql` y pulsa **Run**.
3. Entra a **Project Settings > API** y copia tres datos: la **Project URL**, la llave **anon public** y la llave **service_role**.

La llave `service_role` puede escribir en tu base: nunca la pongas en la página ni en el repositorio.

### 3. Subir el proyecto a GitHub
1. Crea una cuenta en github.com y un repositorio nuevo llamado `domiguard`. Puede ser público.
2. Sube todo el contenido de esta carpeta (botón **Add file > Upload files**, o con git).
3. En el repositorio entra a **Settings > Secrets and variables > Actions > New repository secret** y crea dos secretos:
   - `SUPABASE_URL`: la Project URL.
   - `SUPABASE_SERVICE_KEY`: la llave service_role.

### 3b. Dar de alta a tu primer cliente
En Supabase, **SQL Editor**, ejecuta (cambia los datos; el último comando registra a quién se le manda el correo):

```sql
insert into clientes (id, nombre, marca, palabras, dominios)
  values ('bbva', 'BBVA México', 'bbva', '{bbva}', '{bbva.mx,bbva.com}');
insert into clientes_contacto (cliente_id, correo) values ('bbva', 'CORREO-DE-SEGURIDAD-DEL-CLIENTE');
```

- `marca`: cómo escribe la fuente de reportes el nombre de la marca (en minúsculas, como `santander`).
- `palabras`: nombres que no deberían aparecer en dominios ajenos.
- `dominios`: los dominios oficiales. De aquí salen las variantes que se vigilan.

### 3c. Correo de alertas (opcional)
Con una cuenta SMTP (Gmail con contraseña de aplicación, Brevo, Resend o la del hosting) agrega estos secretos en GitHub: `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Sin ellos las alertas se guardan y aparecen en el panel, pero no se envía correo.

### 4. Conectar la página con la base
Edita `web/config.js` y pega la Project URL y la llave **anon public**. Esa llave solo puede leer, porque el esquema bloquea las escrituras. Guarda el cambio en GitHub.

### 5. Publicar la página
1. En el repositorio entra a **Settings > Pages** y en **Source** elige **GitHub Actions**.
2. Entra a la pestaña **Actions**, abre **Publicar página** y pulsa **Run workflow**. Al terminar te da la dirección pública, parecida a `https://tu-usuario.github.io/domiguard/`.

### 6. Primera carga de datos
En **Actions**, abre **Actualización diaria** y pulsa **Run workflow**. Al terminar, recarga la página: el monitor mostrará datos reales. Desde entonces corre solo cada día.

### 7. Dominio propio (opcional)
Compra un dominio (unos USD 10 a 15 al año, aproximado), y en **Settings > Pages > Custom domain** escribe tu dominio. Sigue las instrucciones de GitHub para crear el registro DNS.

## Herramientas abiertas (de GitHub)

**Ya integradas**
- **dnstwist** (Apache-2.0, `pip install dnstwist`): genera las variantes de cada dominio oficial (homoglifos, omisiones, bitsquatting, subdominios). Se suma a las variantes propias de `detector.py`; si no está instalado, el proyecto sigue con las propias. Se limita a 300 homoglifos por dominio porque genera miles.
- **Phishing.Database** (MIT): segunda fuente de reportes, dominios nuevos de hoy. Solo se guardan los que nombran o imitan a un cliente. La dirección del archivo (`PD_URL` en `actualizar.py`) sale de su README y no se pudo verificar desde este entorno: si falla, la corrida continúa y deja un aviso.

**Siguientes pasos recomendados**
- **openSquat** (GPL-3.0): busca los dominios recién registrados del día (unos 100 mil en su feed comunitario) con tus palabras clave y puede revisar certificados. Úsalo como paso aparte en GitHub Actions y no copies su código dentro del proyecto, por la licencia GPL.
- **certstream-server-go** (MIT): transmisión en vivo de certificados nuevos. Hay que alojarlo en un servidor propio, no corre dentro de GitHub Actions.
- **ail-typo-squatting** (BSD-2) y **URLCrazy**: otros generadores de variantes, útiles para comparar con dnstwist.
- **phishing_catcher** (GPL-3.0): prueba de concepto sobre certificados, sirve como referencia de reglas.

## Seguimiento de cada caso

La columna `estado` de la tabla `alertas` va de `nueva` a `enviada` (el correo se mandó), `en_baja`, `dada_de_baja` o `falsa_alarma`. En esta versión el equipo de Domiguard la cambia a mano desde Supabase (Table Editor) cuando el cliente le avisa. La página pública solo lee.

## Mejorar el modelo

`python3 -m pip install pandas scikit-learn` y luego `python3 scripts/entrenar.py`. Reentrena con las 88,647 URLs del Excel y reescribe `web/model.json`.

Para sumar los sitios nuevos, exporta la tabla `sitios` desde Supabase (Table Editor > Export to CSV) y conviértela al formato de 15 columnas del Excel con las columnas de `x`; luego usa `--nuevos archivo.csv`. Todos son phishing y no traen antigüedad. Si los agregas solos, el modelo aprende que "sin dato" es sospechoso. Suma también `--legitimos archivo.csv`, con el mismo formato de 15 columnas y `phishing = 0`, y con la misma proporción de datos desconocidos.

## Límites y pendientes
- **Qué tan completa es la búsqueda.** La fuente pública solo trae sitios que alguien ya reportó, y la mayoría son de marcas globales (Facebook, Google, Microsoft). Para bancos y fintechs de México el camino B es el que más aporta, pero solo encuentra variantes que sigan un patrón conocido. Para cobertura de nivel comercial hace falta una fuente de dominios recién registrados (por ejemplo WhoisFreaks, USD 200 a 600 al mes) o de certificados emitidos; el motor ya está preparado para sumar un tercer camino.
- **Un dominio parecido no siempre es malicioso.** Puede ser una compra defensiva del propio banco, un sitio sin uso o una empresa homónima. Por eso el camino B marca "por revisar" y el cliente decide. No se abre el sitio para comprobarlo.
- **Prioridad.** Reglas simples y explicables (ver `detector.prioridad`), no un modelo entrenado con casos reales de clientes. Se afinan con retroalimentación de los clientes piloto.
- La fuente no entrega antigüedad del dominio: el camino A la deja como "sin dato" y el camino B la obtiene de RDAP (hasta 40 consultas por corrida).
- "Caído" significa que el nombre ya no resuelve en DNS. Un sitio puede seguir en línea con otro nombre o ser bloqueado sin que el DNS cambie.
- **Acceso por cliente.** El panel de este prototipo es de lectura pública. En producción cada cliente debe entrar con su cuenta (Supabase Auth) y ver solo sus alertas: el cambio de políticas está indicado en `supabase/schema.sql`.
- Revisa los términos de uso de PhishHunt (phishunt.io/tos) antes de publicar. En este proyecto solo se verificó que la página declara dominio público (CC0).
- Los bancos y fintechs de la demostración no son clientes de Domiguard ni tienen relación con el proyecto: se usan como caso real con datos públicos. El proyecto está pensado solo para el sector financiero: bancos, fintechs y plataformas de pago.
- Los planes y precios son una propuesta del equipo, no un dato de mercado.
- **Qué se probó.** La detección, las prioridades, la evidencia y el correo se probaron con 30 registros reales contra una base simulada (el flujo completo corrió sin errores). No se probó contra una cuenta real de Supabase, GitHub ni un servidor de correo, ni contra consultas DNS y RDAP reales: este entorno no tiene internet abierto. Haz la primera corrida a mano (Actions > Actualización diaria > Run workflow) y revisa el registro.
