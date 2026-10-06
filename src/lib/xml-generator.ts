import { Client, Invoice, InvoiceItem, Payment, User, TaxRegime } from '@prisma/client';
import { InvoiceTotals } from './tax';

export interface SdiConfig {
  sender: {
    idPaese: string;
    idCodice: string;
    codiceFiscale: string;
    denominazione: string;
    regimeFiscale: string;
    address: {
      indirizzo: string;
      numeroCivico: string;
      cap: string;
      comune: string;
      provincia: string;
      nazione: string;
    };
    contacts?: {
      telefono?: string;
      email?: string;
    };
  };
  progressivoInvio: string;
}

export interface InvoiceDataForXml {
  invoice: Invoice & {
    client: Client;
    items: InvoiceItem[];
    payments: Payment[];
  };
  totals: InvoiceTotals;
  config: SdiConfig;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}

function formatDateForXml(date: Date | string): string {
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

function formatDecimal(value: number | string | { toString: () => string }): string {
  const num = typeof value === 'number' ? value : parseFloat(value.toString());
  return num.toFixed(2);
}

function formatDecimal8(value: number | string | { toString: () => string }): string {
  const num = typeof value === 'number' ? value : parseFloat(value.toString());
  return num.toFixed(2);
}

function getRegimeFiscaleCode(taxRegime: TaxRegime): string {
  return taxRegime === 'FORFETTARIO' ? 'RF19' : 'RF01';
}

export function userToSdiConfig(user: User): SdiConfig {
  return {
    sender: {
      idPaese: 'IT',
      idCodice: user.vatNumber,
      codiceFiscale: user.taxCode,
      denominazione: user.businessName,
      regimeFiscale: getRegimeFiscaleCode(user.taxRegime),
      address: {
        indirizzo: user.address,
        numeroCivico: 'SNC',
        cap: user.zipCode,
        comune: user.city,
        provincia: user.province || 'RM',
        nazione: user.country || 'IT',
      },
      contacts: {
        email: undefined,
      },
    },
    progressivoInvio: '1',
  };
}

export function generateFatturaPAXml(data: InvoiceDataForXml): string {
  const { invoice, totals, config } = data;
  const { client, items, payments } = invoice;

  const invoiceDate = formatDateForXml(invoice.date);
  const progressivoInvio = config.progressivoInvio || '1';

  const sender = config.sender;
  const clientSdiCode = client.sdiCode || (client.type === 'ITALY' ? '0000000' : 'XXXXXXX');
  const clientCountry = client.country || 'IT';
  const clientZipCode = client.zipCode || (client.type === 'ITALY' ? '00000' : '00000');
  const clientCity = client.city || 'N/A';
  const clientAddress = client.address || 'N/A';
  const clientProvince = clientProvinceFromCountry(clientCountry, clientZipCode);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<FatturaElettronica xmlns="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" ';
  xml += 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ';
  xml += 'versione="FPR12" ';
  xml += `SistemaEmittente="${escapeXml('Solo')}"`;
  xml += '>\n';

  xml += '  <FatturaElettronicaHeader>\n';

  xml += '    <DatiTrasmissione>\n';
  xml += '      <IdTrasmittente>\n';
  xml += `        <IdPaese>${escapeXml(sender.idPaese)}</IdPaese>\n`;
  xml += `        <IdCodice>${escapeXml(sender.idCodice)}</IdCodice>\n`;
  xml += '      </IdTrasmittente>\n';
  xml += `      <ProgressivoInvio>${escapeXml(progressivoInvio)}</ProgressivoInvio>\n`;
  xml += '      <FormatoTrasmissione>FPR12</FormatoTrasmissione>\n';
  xml += `      <CodiceDestinatario>${escapeXml(clientSdiCode)}</CodiceDestinatario>\n`;
  if (sender.contacts?.email) {
    xml += '      <ContattiTrasmittente>\n';
    xml += `        <Email>${escapeXml(sender.contacts.email)}</Email>\n`;
    xml += '      </ContattiTrasmittente>\n';
  }
  if (client.type === 'ITALY' && client.taxCode) {
    xml += `      <PECDestinatario>${escapeXml(client.taxCode + '@pec.example.com')}</PECDestinatario>\n`;
  }
  xml += '    </DatiTrasmissione>\n';

  xml += '    <CedentePrestatore>\n';
  xml += '      <DatiAnagrafici>\n';
  xml += '        <IdFiscaleIVA>\n';
  xml += `          <IdPaese>${escapeXml(sender.idPaese)}</IdPaese>\n`;
  xml += `          <IdCodice>${escapeXml(sender.idCodice)}</IdCodice>\n`;
  xml += '        </IdFiscaleIVA>\n';
  xml += `        <CodiceFiscale>${escapeXml(sender.codiceFiscale)}</CodiceFiscale>\n`;
  xml += '        <Anagrafica>\n';
  xml += `          <Denominazione>${escapeXml(sender.denominazione)}</Denominazione>\n`;
  xml += '        </Anagrafica>\n';
  xml += `        <RegimeFiscale>${escapeXml(sender.regimeFiscale)}</RegimeFiscale>\n`;
  xml += '      </DatiAnagrafici>\n';
  xml += '      <Sede>\n';
  xml += `        <Indirizzo>${escapeXml(sender.address.indirizzo)}</Indirizzo>\n`;
  xml += `        <NumeroCivico>${escapeXml(sender.address.numeroCivico)}</NumeroCivico>\n`;
  xml += `        <CAP>${escapeXml(sender.address.cap)}</CAP>\n`;
  xml += `        <Comune>${escapeXml(sender.address.comune)}</Comune>\n`;
  xml += `        <Provincia>${escapeXml(sender.address.provincia)}</Provincia>\n`;
  xml += `        <Nazione>${escapeXml(sender.address.nazione)}</Nazione>\n`;
  xml += '      </Sede>\n';
  if (sender.contacts?.telefono || sender.contacts?.email) {
    xml += '      <Contatti>\n';
    if (sender.contacts.telefono) {
      xml += `        <Telefono>${escapeXml(sender.contacts.telefono)}</Telefono>\n`;
    }
    if (sender.contacts.email) {
      xml += `        <Email>${escapeXml(sender.contacts.email)}</Email>\n`;
    }
    xml += '      </Contatti>\n';
  }
  xml += '    </CedentePrestatore>\n';

  xml += '    <CessionarioCommittente>\n';
  xml += '      <DatiAnagrafici>\n';
  if (client.vatNumber) {
    xml += '        <IdFiscaleIVA>\n';
    xml += `          <IdPaese>${escapeXml(clientCountry)}</IdPaese>\n`;
    xml += `          <IdCodice>${escapeXml(client.vatNumber)}</IdCodice>\n`;
    xml += '        </IdFiscaleIVA>\n';
  }
  if (client.taxCode) {
    xml += `        <CodiceFiscale>${escapeXml(client.taxCode)}</CodiceFiscale>\n`;
  }
  xml += '        <Anagrafica>\n';
  xml += `          <Denominazione>${escapeXml(client.name)}</Denominazione>\n`;
  xml += '        </Anagrafica>\n';
  xml += '      </DatiAnagrafici>\n';
  xml += '      <Sede>\n';
  xml += `        <Indirizzo>${escapeXml(clientAddress)}</Indirizzo>\n`;
  xml += `        <NumeroCivico>SNC</NumeroCivico>\n`;
  xml += `        <CAP>${escapeXml(clientZipCode)}</CAP>\n`;
  xml += `        <Comune>${escapeXml(clientCity)}</Comune>\n`;
  if (clientCountry === 'IT') {
    xml += `        <Provincia>${escapeXml(clientProvince)}</Provincia>\n`;
  }
  xml += `        <Nazione>${escapeXml(clientCountry)}</Nazione>\n`;
  xml += '      </Sede>\n';
  xml += '    </CessionarioCommittente>\n';

  xml += '  </FatturaElettronicaHeader>\n';

  xml += '  <FatturaElettronicaBody>\n';
  xml += '    <DatiGenerali>\n';
  xml += '      <DatiGeneraliDocumento>\n';
  xml += '        <TipoDocumento>TD01</TipoDocumento>\n';
  xml += '        <Divisa>EUR</Divisa>\n';
  xml += `        <Data>${escapeXml(invoiceDate)}</Data>\n`;
  xml += `        <Numero>${escapeXml(invoice.number.toString())}</Numero>\n`;

  if (totals.stampDutyAmount > 0) {
    xml += '        <DatiBollo>\n';
    xml += '          <BolloVirtuale>SI</BolloVirtuale>\n';
    xml += `          <ImportoBollo>${formatDecimal(totals.stampDutyAmount)}</ImportoBollo>\n`;
    xml += '        </DatiBollo>\n';
  }

  xml += `        <ImportoTotaleDocumento>${formatDecimal(totals.totalAmount)}</ImportoTotaleDocumento>\n`;
  xml += `        <Causale>${escapeXml(totals.legalNotes)}</Causale>\n`;
  xml += '      </DatiGeneraliDocumento>\n';
  xml += '    </DatiGenerali>\n';

  xml += '    <DatiBeniServizi>\n';

  items.forEach((item, index) => {
    const lineNumber = index + 1;
    xml += '      <DettaglioLinee>\n';
    xml += `        <NumeroLinea>${lineNumber}</NumeroLinea>\n`;
    xml += `        <Descrizione>${escapeXml(item.description)}</Descrizione>\n`;
    xml += '        <Quantita>1.00</Quantita>\n';
    xml += '        <UnitaMisura>NR</UnitaMisura>\n';
    xml += `        <PrezzoUnitario>${formatDecimal8(item.amount)}</PrezzoUnitario>\n`;
    xml += `        <PrezzoTotale>${formatDecimal8(item.amount)}</PrezzoTotale>\n`;
    
    const vatRate = totals.vatRate || 0;
    xml += `        <AliquotaIVA>${vatRate.toFixed(2)}</AliquotaIVA>\n`;
    xml += `        <Natura>${escapeXml(totals.vatNatureCode)}</Natura>\n`;
    xml += `        <RiferimentoNormativo>${escapeXml(totals.legalNotes)}</RiferimentoNormativo>\n`;
    xml += '      </DettaglioLinee>\n';
  });

  xml += '      <DatiRiepilogo>\n';
  xml += `        <AliquotaIVA>${(totals.vatRate || 0).toFixed(2)}</AliquotaIVA>\n`;
  xml += `        <Natura>${escapeXml(totals.vatNatureCode)}</Natura>\n`;
  xml += `        <ImponibileImporto>${formatDecimal(totals.subtotal)}</ImponibileImporto>\n`;
  xml += `        <Imposta>${formatDecimal(totals.vatAmount)}</Imposta>\n`;
  xml += '        <EsigibilitaIVA>I</EsigibilitaIVA>\n';
  xml += `        <RiferimentoNormativo>${escapeXml(totals.legalNotes)}</RiferimentoNormativo>\n`;
  xml += '      </DatiRiepilogo>\n';

  if (totals.stampDutyAmount > 0) {
    xml += '      <DatiRiepilogo>\n';
    xml += '        <AliquotaIVA>0.00</AliquotaIVA>\n';
    xml += '        <Natura>N2.2</Natura>\n';
    xml += `        <ImponibileImporto>${formatDecimal(totals.stampDutyAmount)}</ImponibileImporto>\n`;
    xml += '        <Imposta>0.00</Imposta>\n';
    xml += '        <EsigibilitaIVA>I</EsigibilitaIVA>\n';
    xml += '        <RiferimentoNormativo>Imposta di bollo assolta in modo virtuale ai sensi del D.M. 17/06/2014</RiferimentoNormativo>\n';
    xml += '      </DatiRiepilogo>\n';
  }

  xml += '    </DatiBeniServizi>\n';

  xml += '    <DatiPagamento>\n';
  xml += '      <CondizioniPagamento>TP02</CondizioniPagamento>\n';
  
  xml += '      <DettaglioPagamento>\n';
  xml += `        <ModalitaPagamento>MP05</ModalitaPagamento>`;
  xml += `        <ImportoPagamento>${formatDecimal(totals.totalAmount)}</ImportoPagamento>\n`;
  xml += `        <DataRiferimentoTerminiPagamento>${escapeXml(invoiceDate)}</DataRiferimentoTerminiPagamento>\n`;
  xml += `        <DataScadenzaPagamento>${escapeXml(invoiceDate)}</DataScadenzaPagamento>\n`;
  xml += '      </DettaglioPagamento>\n';
  xml += '    </DatiPagamento>\n';

  xml += '  </FatturaElettronicaBody>\n';
  xml += '</FatturaElettronica>\n';

  return xml;
}

function clientProvinceFromCountry(country: string, zipCode: string): string {
  if (country !== 'IT') return '';
  const provinceMap: Record<string, string> = {
    '001': 'RM', '101': 'TO', '201': 'MI', '301': 'VE', '401': 'BO',
    '501': 'FI', '601': 'AN', '701': 'BA', '801': 'NA', '901': 'PA',
  };
  const prefix = zipCode.substring(0, 3);
  return provinceMap[prefix] || 'RM';
}

export function generateFileName(invoice: Invoice): string {
  const dateStr = formatDateForXml(invoice.date).replace(/-/g, '');
  return `IT${invoice.clientId}_${dateStr}_${invoice.number}.xml`;
}