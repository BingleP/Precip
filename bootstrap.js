if (!document.cookie.split("; ").find((row) => row.startsWith("precip.preferredLocation.v1="))) {
  window.location.replace("welcome.html");
}
