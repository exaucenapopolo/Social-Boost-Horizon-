// scripts.js

document.addEventListener("DOMContentLoaded", function () {
  AOS.init({ duration: 800, once: true });

  const backgroundAnimation = document.querySelector(".background-animation");
  const numberOfClouds = 20;

  for (let i = 0; i < numberOfClouds; i++) {
    const cloud = document.createElement("div");
    cloud.classList.add("cloud");

    const size = Math.random() * (250 - 150) + 150;
    cloud.style.width = `${size}px`;
    cloud.style.height = `${size * 0.6}px`;
    cloud.style.borderRadius = `${size / 2}px / ${size * 0.3}px`;

    cloud.style.left = `${Math.random() * 100 + 100}vw`;
    cloud.style.top = `${Math.random() * 85}vh`;

    const animationDuration = Math.random() * (60 - 30) + 30;
    cloud.style.animationDuration = `${animationDuration}s`;

    cloud.style.animationDelay = `${Math.random() * -animationDuration}s`;

    cloud.style.setProperty("--width", `${size}px`);
    const scale = Math.random() * (1.1 - 0.9) + 0.9;
    cloud.style.setProperty("--scale", scale);

    backgroundAnimation.appendChild(cloud);
  }

  // Gestion du menu hamburger
  const header = document.querySelector("header");
  const hamburger = document.querySelector(".icon-hamburger");
  hamburger.addEventListener("click", () => {
    header.classList.toggle("open");
  });
});