' Démarre l'application en arrière-plan, sans aucune fenêtre visible.
' Fait pour être placé (ou raccourci) dans le dossier "Démarrage" de Windows
' (Win+R puis "shell:startup") afin que l'application soit toujours disponible
' dès l'ouverture de session, sans avoir à ouvrir une invite de commande.
'
' L'application reste ensuite accessible à tout moment sur http://localhost:4531
' Elle ne s'ouvre PAS automatiquement dans le navigateur ici, pour éviter
' qu'une fenêtre s'ouvre toute seule à chaque connexion à Windows.
' Utilisez "Lancer (avec fenetre).bat" si vous voulez l'ouvrir immédiatement.

Dim fso, scriptDir, shell
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = scriptDir

' 0 = fenêtre cachée, False = ne pas attendre la fin du programme
shell.Run "cmd /c node server.js >> app.log 2>>&1", 0, False
