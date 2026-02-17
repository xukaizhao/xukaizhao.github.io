(function(){
  const year = document.getElementById("year");
  if(year){ year.textContent = String(new Date().getFullYear()); }

  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");
  if(navToggle && nav){
    navToggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        if(nav.classList.contains("open")){
          nav.classList.remove("open");
          navToggle.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  const revealEls = Array.from(document.querySelectorAll(".reveal"));
  if("IntersectionObserver" in window){
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    revealEls.forEach(el => io.observe(el));
  }else{
    revealEls.forEach(el => el.classList.add("is-visible"));
  }

  const chips = Array.from(document.querySelectorAll(".chip"));
  const cards = Array.from(document.querySelectorAll(".paper-card"));
  const search = document.getElementById("pubSearch");
  const count = document.getElementById("pubCount");

  let activeFilter = "All";
  let activeQuery = "";

  function normalize(text){
    return String(text || "").toLowerCase().trim();
  }

  function apply(){
    let visible = 0;
    cards.forEach(card => {
      const cat = card.getAttribute("data-category") || "";
      const hay = normalize(card.textContent);
      const okFilter = (activeFilter === "All") || (cat === activeFilter);
      const okQuery = !activeQuery || hay.includes(activeQuery);
      const show = okFilter && okQuery;
      card.style.display = show ? "" : "none";
      if(show){ visible += 1; }
    });
    if(count){ count.textContent = String(visible); }
  }

  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      chips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.getAttribute("data-filter") || "All";
      apply();
    });
  });

  if(search){
    search.addEventListener("input", () => {
      activeQuery = normalize(search.value);
      apply();
    });
  }

  apply();

  // Copy to clipboard helpers
  const copyButtons = Array.from(document.querySelectorAll("[data-copy]"));
  function fallbackCopy(text){
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand("copy"); }catch(e){}
    document.body.removeChild(ta);
  }

  copyButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "";
      const original = btn.textContent;
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
        }else{
          fallbackCopy(text);
        }
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("copied");
        }, 1200);
      }catch(e){
        fallbackCopy(text);
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = original; }, 1200);
      }
    });
  });

  // Collapsible sections - show first 3 items, rest collapsed
  const collapsibleHeaders = Array.from(document.querySelectorAll(".collapsible-header"));
  collapsibleHeaders.forEach(header => {
    const targetId = header.getAttribute("data-target");
    const content = document.getElementById(targetId);
    
    if(content){
      // Initially show partial content (first 3 items)
      header.classList.add("collapsed");
      content.classList.add("collapsed");
      
      header.addEventListener("click", () => {
        const isCollapsed = header.classList.toggle("collapsed");
        content.classList.toggle("collapsed", isCollapsed);
        content.classList.toggle("expanded", !isCollapsed);
      });
    }
  });

  // Visitor statistics (placeholder - integrate with your analytics service)
  const visitorCountEl = document.getElementById("visitorCount");
  if(visitorCountEl){
    // Example: You can replace this with actual visitor count from your analytics
    // For now, using localStorage as a simple counter
    let count = parseInt(localStorage.getItem('visitorCount') || '0');
    count += 1;
    localStorage.setItem('visitorCount', count.toString());
    
    // Animate counter
    let current = 0;
    const target = count;
    const increment = Math.ceil(target / 50);
    const timer = setInterval(() => {
      current += increment;
      if(current >= target){
        current = target;
        clearInterval(timer);
      }
      visitorCountEl.textContent = current.toLocaleString();
    }, 30);
  }
})();