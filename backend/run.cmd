@echo off
setlocal
set JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot
set JAR=%~dp0target\novel-map-backend-0.1.0.jar
if not exist "%JAR%" (
  echo JAR missing. Run: mvn -DskipTests package
  exit /b 1
)
echo Starting novel-map-spring on http://127.0.0.1:8787
echo Stop Node server first if it is using 8787.
"%JAVA_HOME%\bin\java.exe" -jar "%JAR%" %*
