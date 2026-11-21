(function(){
  const el=document.getElementById("count");
  let n=Math.max(1,Number(el&&el.dataset.seconds)||10);
  const t=setInterval(()=>{
    n--;
    if(el)el.textContent=n;
    if(n<=0){clearInterval(t);location.replace("/");}
  },1000);
})();
