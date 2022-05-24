var menubutton = document.getElementById("menubutton");
var sidenav = document.getElementById("sidenav");
sidenav.style.right = "-250px";
menubutton.onclick = function () {
    if (sidenav.style.right == "-250px") {
        sidenav.style.right = "0";
    }
    else {
        sidenav.style.right = "-250px";
    }
}
