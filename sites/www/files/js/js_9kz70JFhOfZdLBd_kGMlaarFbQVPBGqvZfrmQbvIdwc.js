Drupal.locale = { 'pluralFormula': function ($n) { return Number(($n!=1)); }, 'strings': {"An AJAX HTTP error occurred.":"Ocorreu um erro HTTP no AJAX","HTTP Result Code: !status":"C\u00f3digo do Resultado HTTP:  !status","An AJAX HTTP request terminated abnormally.":"Uma requisi\u00e7\u00e3o HTTP AJAX terminou de forma anormal.","Debugging information follows.":"Estas s\u00e3o as informa\u00e7\u00f5es de depura\u00e7\u00e3o.","Path: !uri":"Caminho: !url","StatusText: !statusText":"Texto de Status: !statusText","ResponseText: !responseText":"Texto de Resposta: !responseText","ReadyState: !readyState":"ReadyState: !readyState","Loading":"Carregando","(active tab)":"(aba ativa)","Hide":"Ocultar","Show":"Exibir","@title dialog":"Di\u00e1logo @title","Configure":"Configurar","Show shortcuts":"Mostrar atalhos","Hide shortcuts":"Esconder atalhos","Re-order rows by numerical weight instead of dragging.":"Re-ordernar as linhas por campos n\u00famericos de peso ao inv\u00e9s de arrastar-e-soltar.","Show row weights":"Exibir pesos das linhas","Hide row weights":"Ocultar pesos das linhas","Drag to re-order":"Arraste para reordenar","Changes made in this table will not be saved until the form is submitted.":"Mudan\u00e7as feitas nesta tabela n\u00e3o ser\u00e3o salvas at\u00e9 que o formul\u00e1rio seja enviado.","Next":"Pr\u00f3ximo","Select all rows in this table":"Selecionar todas as linhas da tabela","Deselect all rows in this table":"Desmarcar todas as linhas da tabela","Not published":"N\u00e3o publicado","Please wait...":"Por favor, espere um pouco...","Not in book":"Fora do livro","New book":"Novo livro","By @name on @date":"Por @name em @date","By @name":"Por @name","Not in menu":"Fora do menu","Alias: @alias":"URL Alternativa: @alias","No alias":"Nenhuma URL alternativa","New revision":"Nova revis\u00e3o","The changes to these blocks will not be saved until the \u003cem\u003eSave blocks\u003c\/em\u003e button is clicked.":"As altera\u00e7\u00f5es nesses blocos n\u00e3o v\u00e3o ser salvas enquanto o bot\u00e3o \u003cem\u003eSalvar Blocos\u003c\/em\u003e n\u00e3o for clicado.","This permission is inherited from the authenticated user role.":"Essa permiss\u00e3o \u00e9 herdada do papel de usu\u00e1rio autenticado.","No revision":"Sem revis\u00e3o","@number comments per page":"@number coment\u00e1rios por p\u00e1gina","Not restricted":"Sem restri\u00e7\u00f5es","Not customizable":"N\u00e3o \u00e9 personaliz\u00e1vel","Restricted to certain pages":"Restrito para certas p\u00e1ginas","The block cannot be placed in this region.":"O bloco n\u00e3o pode ser colocado nessa regi\u00e3o.","Hide summary":"Ocultar sum\u00e1rio","Edit summary":"Editar resumo","The selected file %filename cannot be uploaded. Only files with the following extensions are allowed: %extensions.":"O arquivo selecionado %filename n\u00e3o p\u00f4de ser transferido. Somente arquivos com as seguintes extens\u00f5es s\u00e3o permitidos: %extensions.","Autocomplete popup":"Popup de autocompletar","Searching for matches...":"Procurando por dados correspondentes..."} };;

(function ($) {
  Drupal.Panels = {};

  Drupal.Panels.autoAttach = function() {
    if ($.browser.msie) {
      // If IE, attach a hover event so we can see our admin links.
      $("div.panel-pane").hover(
        function() {
          $('div.panel-hide', this).addClass("panel-hide-hover"); return true;
        },
        function() {
          $('div.panel-hide', this).removeClass("panel-hide-hover"); return true;
        }
      );
      $("div.admin-links").hover(
        function() {
          $(this).addClass("admin-links-hover"); return true;
        },
        function(){
          $(this).removeClass("admin-links-hover"); return true;
        }
      );
    }
  };

  $(Drupal.Panels.autoAttach);
})(jQuery);
;
