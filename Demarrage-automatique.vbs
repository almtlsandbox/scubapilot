' ANCIEN lanceur, conserve uniquement pour les raccourcis de demarrage deja en place.
' VBScript est en cours de retrait de Windows : utilisez plutot
' "Installer le demarrage automatique.bat", qui cree un raccourci sans VBScript
' (et retire l'ancien raccourci vers ce fichier).
'
' Demarre ScubaPilot en arriere-plan, sans fenetre, via launcher.js (une seule copie a la fois).

Dim fso, scriptDir, shell
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = scriptDir

' 0 = fenetre cachee, False = ne pas attendre la fin du programme
shell.Run "node launcher.js", 0, False
