#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

WORK = Path('/home/delads/.openclaw/workspace')
TARIFF_FILE = WORK / 'skills/emporia-energy/config/tariff.json'
VEHICLE_FILE = WORK / 'skills/emporia-energy/config/vehicle.json'


def litres_from_mpg(miles, mpg):
    return miles / mpg * 4.54609


def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: ev_charge_savings.py <kwh> <petrol_price_per_litre_eur> [charge_cost_eur]')

    kwh = float(sys.argv[1])
    petrol_price = float(sys.argv[2])
    charge_cost_override = float(sys.argv[3]) if len(sys.argv) > 3 else None

    vehicle = json.loads(VEHICLE_FILE.read_text())['vehicle']
    tariff = json.loads(TARIFF_FILE.read_text())

    mi_per_kwh = float(vehicle['ev_efficiency_miles_per_kwh'])
    petrol_mpg = float(vehicle['petrol_efficiency_mpg'])
    miles = kwh * mi_per_kwh
    litres = litres_from_mpg(miles, petrol_mpg)
    petrol_cost = litres * petrol_price

    result = {
        'vehicle': vehicle['name'],
        'electricity_kwh': kwh,
        'ev_efficiency_miles_per_kwh': mi_per_kwh,
        'estimated_electric_miles': miles,
        'petrol_efficiency_mpg': petrol_mpg,
        'petrol_price_per_litre_eur': petrol_price,
        'equivalent_petrol_litres': litres,
        'equivalent_petrol_cost_eur': petrol_cost,
        'charge_cost_eur': charge_cost_override,
        'estimated_savings_eur': (petrol_cost - charge_cost_override) if charge_cost_override is not None else None,
        'tariff_currency': tariff.get('currency', 'EUR'),
        'sources': {
            'vehicle_config': str(VEHICLE_FILE),
            'tariff_config': str(TARIFF_FILE)
        }
    }
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
