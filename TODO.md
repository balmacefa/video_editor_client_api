crear una api endpoint /single_api

type: compile_sequential_video
data:[{base_64:str, type:str, content: str, id: number}]

que permite leer un array de 
data:
[
    base_64
    //PIxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEA8yECATYZ6ZmQJxYWTJ1Y15BAY2cqdm1LhkamFzoxYfMhAh6CPOwhgGLAcfDACl61GnsxEIII...
    type: tts
    content: ¡Bienvenidos a [Nombre del Podcast]! Soy [Tu Nombre], y juntos exploraremos los Derechos Humanos, el código ético que nos conecta a todos en este planeta.
    id: 0
]

y los compile en orden de voz los documentos base64 tts,
luego compilar usando los videos, cambiar cuando aparece uno en el stack del array. priorizando al siguiente video en pantalla.

retornar el docuemto binario en response.data

<!-- Production URL: -->
https://wsw4kgog84k08k08gk8oosso.balmacefa.com/

<!-- Coolify pannel -->


https://coolify.balmacefa.com/project/jwsgogosskwcw80gcosw0o4c/environment/jg8gk080ck08ssww8488wsw4/application/wsw4kgog84k08k08gk8oosso
