try:
    import pandas
    print("Pandas is installed version:", pandas.__version__)
    import openpyxl
    print("Openpyxl is installed version:", openpyxl.__version__)
except ImportError as e:
    print("Import Error:", e)
except Exception as e:
    print("Other Error:", e)
